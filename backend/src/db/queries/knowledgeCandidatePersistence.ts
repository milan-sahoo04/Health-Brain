import { Session } from "neo4j-driver";
import { Hypothesis } from "../../services/ere/hypothesisFactory";
import { Evidence } from "../../services/ere/evidence";
import { ContradictionReport } from "../../services/ere/contradictionAnalyzer";
import { ScoredHypothesis } from "../../services/ere/confidenceScorer";

export interface PersistedKnowledgeCandidateSummary {
  hypothesisId: string;
  knowledgeCandidateId: string;
  status: string;
  finalConfidence: number;
}

/**
 * Writes one Evidence node. MERGE on its own deterministic id (from M5.2)
 * so re-running evaluation doesn't duplicate identical evidence.
 */
async function persistEvidence(
  session: Session,
  evidence: Evidence,
): Promise<void> {
  await session.run(
    `
    MERGE (e:Evidence {id: $id})
    SET
      e.patientId = $patientId,
      e.evidenceType = $evidenceType,
      e.description = $description,
      e.sourceEventIds = $sourceEventIds,
      e.sourceNodeIds = $sourceNodeIds,
      e.sourceRelationshipIds = $sourceRelationshipIds,
      e.polarity = $polarity,
      e.weight = $weight,
      e.strength = $strength,
      e.recency = $recency,
      e.frequency = $frequency,
      e.consistency = $consistency,
      e.confidenceContribution = $confidenceContribution,
      e.updatedAt = $now,
      e.createdAt = coalesce(e.createdAt, $now)
    `,
    { ...evidence, now: new Date().toISOString() },
  );
}

/**
 * Writes one scored Hypothesis as an upserted (:KnowledgeCandidate) node,
 * linked to the Patient, its source (:Pattern or :PatternCandidate), and
 * every piece of Evidence that fed into it. Always writes regardless of
 * status — accepted/rejected/inconclusive are all valuable audit history,
 * same "never silently drop" rule as patternPersistence.ts.
 *
 * Upsert key = (patientId, hypothesisId) — hypothesisId is already
 * deterministic (M5.1), so re-evaluating the same source Pattern/
 * PatternCandidate updates the same KnowledgeCandidate rather than
 * creating duplicates on every re-run.
 */
export async function persistKnowledgeCandidate(
  session: Session,
  hypothesis: Hypothesis,
  evidence: Evidence[],
  contradictionReport: ContradictionReport,
  scored: ScoredHypothesis,
): Promise<PersistedKnowledgeCandidateSummary> {
  const now = new Date().toISOString();

  // Evidence written first — KnowledgeCandidate below references it by id.
  for (const e of evidence) {
    await persistEvidence(session, e);
  }

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate {
      patientId: $patientId,
      hypothesisId: $hypothesisId
    })
    SET
      kc.schemaVersion = $schemaVersion,
      kc.sourceType = $sourceType,
      kc.claim = $claim,
      kc.direction = $direction,
      kc.priorConfidence = $priorConfidence,
      kc.involvedMetricNames = $involvedMetricNames,
      kc.status = $status,
      kc.finalConfidence = $finalConfidence,
      kc.confidenceBreakdown = $confidenceBreakdownJson,
      kc.reasoningSteps = $reasoningSteps,
      kc.contradictionReport = $contradictionReportJson,
      kc.fusionKey = $fusionKey,
      kc.updatedAt = $now,
      kc.generatedAt = coalesce(kc.generatedAt, $now)
    WITH kc
    MATCH (source) WHERE elementId(source) = $sourceNodeId
    MERGE (kc)-[:DERIVED_FROM]->(source)
    `,
    {
      patientId: hypothesis.patientId,
      hypothesisId: hypothesis.id,
      schemaVersion: hypothesis.schemaVersion,
      sourceType: hypothesis.sourceType,
      claim: hypothesis.claim,
      direction: hypothesis.direction,
      priorConfidence: hypothesis.priorConfidence,
      involvedMetricNames: hypothesis.involvedMetricNames,
      sourceNodeId: hypothesis.sourceNodeId,
      status: scored.status,
      finalConfidence: scored.confidenceBreakdown.finalConfidence,
      // Neo4j properties can't be nested maps — store as JSON strings,
      // same pattern already used for supportingEdges in M4.4.
      confidenceBreakdownJson: JSON.stringify(scored.confidenceBreakdown),
      reasoningSteps: scored.reasoningSteps,
      contradictionReportJson: JSON.stringify(contradictionReport),
      fusionKey: hypothesis.fusionKey,
      now,
    },
  );

  // Link evidence to the candidate, separately from the write above —
  // evidence list length varies per hypothesis, so this stays a simple
  // UNWIND rather than cramming it into the single-row SET above.
  if (evidence.length > 0) {
    await session.run(
      `
      MATCH (kc:KnowledgeCandidate {patientId: $patientId, hypothesisId: $hypothesisId})
      UNWIND $evidenceIds AS evidenceId
      MATCH (e:Evidence {id: evidenceId})
      MERGE (kc)-[:HAS_EVIDENCE]->(e)
      `,
      {
        patientId: hypothesis.patientId,
        hypothesisId: hypothesis.id,
        evidenceIds: evidence.map((e) => e.id),
      },
    );
  }

  const readback = await session.run(
    `
    MATCH (kc:KnowledgeCandidate {patientId: $patientId, hypothesisId: $hypothesisId})
    RETURN elementId(kc) AS id
    `,
    { patientId: hypothesis.patientId, hypothesisId: hypothesis.id },
  );

  return {
    hypothesisId: hypothesis.id,
    knowledgeCandidateId: readback.records[0].get("id"),
    status: scored.status,
    finalConfidence: scored.confidenceBreakdown.finalConfidence,
  };
}
