import { Session } from "neo4j-driver";
import { KnowledgeCandidateInput } from "../../services/knowledge/knowledgePromoter";
import { computeKnowledgeVersionId } from "../../services/knowledge/knowledgeTypes";

/**
 * First-time Knowledge creation. Writes BOTH the durable Knowledge node
 * AND its first KnowledgeVersion snapshot in one transaction, plus all
 * four relationships from the M6 architecture review's Step 6:
 * HAS_KNOWLEDGE, SUPPORTED_BY (reusing M5's real :Evidence nodes via the
 * candidate's HAS_EVIDENCE links), PROMOTED_FROM, HAS_VERSION.
 *
 * M6.2 scope: assumes the Knowledge node does NOT already exist —
 * promoteCandidate() checks this before calling here. Uses CREATE, not
 * MERGE, deliberately: a duplicate-detection bug here should fail loudly,
 * not silently upsert over something version-append logic should own.
 */
export async function createKnowledge(
  session: Session,
  knowledgeId: string,
  candidate: KnowledgeCandidateInput,
): Promise<void> {
  const now = new Date().toISOString();
  const versionId = computeKnowledgeVersionId(knowledgeId, 1);

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    CREATE (k:Knowledge {
      id: $knowledgeId,
      patientId: $patientId,
      claim: $claim,
      currentConfidence: $finalConfidence,
      currentStatus: "active",
      sourceType: $sourceType,
      involvedMetricNames: $involvedMetricNames,
      firstPromotedAt: $now,
      lastEvaluatedAt: $now,
      versionCount: 1
    })
    CREATE (p)-[:HAS_KNOWLEDGE]->(k)
    CREATE (v:KnowledgeVersion {
      id: $versionId,
      knowledgeId: $knowledgeId,
      versionNumber: 1,
      confidence: $finalConfidence,
      confidenceBreakdownJson: $confidenceBreakdown,
      reasoningSteps: $reasoningSteps,
      contradictionReportJson: $contradictionReport,
      knowledgeCandidateId: $candidateElementId,
      createdAt: $now
    })
    CREATE (k)-[:HAS_VERSION]->(v)
    WITH k
    MATCH (kc) WHERE elementId(kc) = $candidateElementId
    CREATE (k)-[:PROMOTED_FROM]->(kc)
    WITH k, kc
    OPTIONAL MATCH (kc)-[:HAS_EVIDENCE]->(e:Evidence)
    FOREACH (evidence IN CASE WHEN e IS NOT NULL THEN [e] ELSE [] END |
      CREATE (k)-[:SUPPORTED_BY]->(evidence)
    )
    `,
    {
      knowledgeId,
      versionId,
      patientId: candidate.patientId,
      claim: candidate.claim,
      finalConfidence: candidate.finalConfidence,
      sourceType: candidate.sourceType,
      involvedMetricNames: candidate.involvedMetricNames,
      confidenceBreakdown: candidate.confidenceBreakdown,
      reasoningSteps: candidate.reasoningSteps,
      contradictionReport: candidate.contradictionReport,
      candidateElementId: candidate.candidateElementId,
      now,
    },
  );
}
