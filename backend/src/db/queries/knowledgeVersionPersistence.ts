import { Session } from "neo4j-driver";
import { KnowledgeCandidateInput } from "../../services/knowledge/knowledgePromoter";
import { computeKnowledgeVersionId } from "../../services/knowledge/knowledgeTypes";

export interface AppendVersionResult {
  knowledgeId: string;
  newVersionNumber: number;
}

/**
 * Appends a new KnowledgeVersion to an EXISTING Knowledge node, in a
 * single Neo4j transaction — per the approved M6.3 architecture, this is
 * the concrete fix for the read-then-write race window: versionCount is
 * read AND incremented AND written inside one query, so two concurrent
 * callers cannot both compute the same "next" version number.
 *
 * Does NOT touch createKnowledge() (M6.2) — this function assumes the
 * Knowledge node already exists; the caller (promoteCandidate) is
 * responsible for routing to the correct path based on
 * decideVersioningAction()'s output (M6.3.a).
 *
 * Preserves all M6.2 relationships untouched: HAS_KNOWLEDGE, SUPPORTED_BY,
 * and PROMOTED_FROM from the ORIGINAL promotion are not modified here —
 * this only adds a new HAS_VERSION edge and updates the Knowledge node's
 * mutable summary fields (currentConfidence, versionCount,
 * lastEvaluatedAt, confidenceTrend).
 */
export async function appendKnowledgeVersion(
  session: Session,
  knowledgeId: string,
  candidate: KnowledgeCandidateInput,
  trend: "improving" | "declining" | "stable",
): Promise<AppendVersionResult> {
  const now = new Date().toISOString();

  const result = await session.run(
    `
    MATCH (k:Knowledge {id: $knowledgeId})
    WITH k, k.versionCount + 1 AS newVersionNumber
    CREATE (v:KnowledgeVersion {
      id: $versionIdPrefix + toString(newVersionNumber),
      knowledgeId: $knowledgeId,
      versionNumber: newVersionNumber,
      confidence: $finalConfidence,
      confidenceBreakdownJson: $confidenceBreakdown,
      reasoningSteps: $reasoningSteps,
      contradictionReportJson: $contradictionReport,
      knowledgeCandidateId: $candidateElementId,
      createdAt: $now
    })
    CREATE (k)-[:HAS_VERSION]->(v)
    SET
      k.currentConfidence = $finalConfidence,
      k.versionCount = newVersionNumber,
      k.lastEvaluatedAt = $now,
      k.confidenceTrend = $trend
    RETURN newVersionNumber
    `,
    {
      knowledgeId,
      versionIdPrefix: `knowledge-version:${knowledgeId}:`,
      finalConfidence: candidate.finalConfidence,
      confidenceBreakdown: candidate.confidenceBreakdown,
      reasoningSteps: candidate.reasoningSteps,
      contradictionReport: candidate.contradictionReport,
      candidateElementId: candidate.candidateElementId,
      trend,
      now,
    },
  );

  if (result.records.length === 0) {
    throw new Error(
      `appendKnowledgeVersion: Knowledge ${knowledgeId} not found — cannot append to a nonexistent node.`,
    );
  }

  return {
    knowledgeId,
    newVersionNumber: result.records[0].get("newVersionNumber").toNumber(),
  };
}
