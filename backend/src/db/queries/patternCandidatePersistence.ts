import { Session } from "neo4j-driver";
import { CandidatePrediction } from "../../services/gnnInferenceClient";

const MIN_CONFIDENCE_TO_STORE = 0.5; // matches the gnn-service threshold
const ACTIVE_THRESHOLD = 0.75;

export type CandidateStatus = "active" | "below_threshold";

export interface PersistedCandidateSummary {
  sourceNodeId: string;
  targetNodeId: string;
  status: CandidateStatus;
  confidence: number;
}

function candidateStatus(confidence: number): CandidateStatus {
  return confidence >= ACTIVE_THRESHOLD ? "active" : "below_threshold";
}

/**
 * Writes one GNN candidate as an upserted (:PatternCandidate) node,
 * linked from Patient via HAS_CANDIDATE. Mirrors persistPattern()'s
 * MERGE-key + coalesce(createdAt) convention exactly, so both pattern
 * systems (legacy :Pattern and new :PatternCandidate) behave consistently
 * in Neo4j even though they're produced by different pipelines.
 *
 * Upsert key = (patientId, sourceNodeId, targetNodeId, relation, modelVersion) —
 * NOT sorted alphabetically like :Pattern, because source/target here
 * come from real graph node ids (not human-readable metric names) and
 * order is meaningful metadata even though relation is symmetric today.
 */
export async function persistCandidate(
  session: Session,
  patientId: string,
  modelVersion: string,
  graphVersion: string,
  candidate: CandidatePrediction,
): Promise<PersistedCandidateSummary> {
  const status = candidateStatus(candidate.confidence);
  if (candidate.confidence < MIN_CONFIDENCE_TO_STORE) {
    return {
      sourceNodeId: candidate.sourceNodeId,
      targetNodeId: candidate.targetNodeId,
      status: "below_threshold",
      confidence: candidate.confidence,
    };
  }

  const now = new Date().toISOString();

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_CANDIDATE]->(c:PatternCandidate {
      patientId: $patientId,
      sourceNodeId: $sourceNodeId,
      targetNodeId: $targetNodeId,
      relation: $relation,
      modelVersion: $modelVersion
    })
    SET
      c.confidence = $confidence,
      c.supportingNodes = $supportingNodes,
      c.supportingEdges = $supportingEdges,
      c.explanation = $explanation,
      c.embeddingVersion = "node2vec-v1",
      c.graphVersion = $graphVersion,
      c.status = $status,
      c.updatedAt = $now,
      c.generatedAt = coalesce(c.generatedAt, $now)
    `,
    {
      patientId,
      sourceNodeId: candidate.sourceNodeId,
      targetNodeId: candidate.targetNodeId,
      relation: candidate.relation,
      modelVersion,
      confidence: candidate.confidence,
      supportingNodes: candidate.supportingNodes,
      supportingEdges: candidate.supportingEdges.map((e) => JSON.stringify(e)), // Neo4j props can't nest maps in lists
      explanation: candidate.explanation,
      graphVersion,
      status,
      now,
    },
  );

  return {
    sourceNodeId: candidate.sourceNodeId,
    targetNodeId: candidate.targetNodeId,
    status,
    confidence: candidate.confidence,
  };
}

export async function persistAllCandidates(
  session: Session,
  patientId: string,
  modelVersion: string,
  graphVersion: string,
  candidates: CandidatePrediction[],
): Promise<PersistedCandidateSummary[]> {
  const summaries: PersistedCandidateSummary[] = [];
  for (const c of candidates) {
    summaries.push(
      await persistCandidate(session, patientId, modelVersion, graphVersion, c),
    );
  }
  return summaries;
}
