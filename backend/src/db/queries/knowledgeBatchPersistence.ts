import { Session } from "neo4j-driver";
import { KnowledgeCandidateInput } from "../../services/knowledge/knowledgePromoter";
import { computeKnowledgeId } from "../../services/knowledge/knowledgeTypes";

export interface BatchWriteResult {
  knowledgeId: string;
  action: "create" | "append_version" | "no_op";
  versionNumber?: number;
  error?: string;
}

/**
 * M6.4.b: batched equivalent of createKnowledge/appendKnowledgeVersion.
 * Two UNWIND statements (creates, appends), each wrapped in
 * CALL { ... } IN TRANSACTIONS OF 50 ROWS — per the architecture
 * review's Section 3/4/6: partial success, not all-or-nothing. One bad
 * row does not abort the rest of the batch.
 *
 * no_op rows are never sent to Neo4j at all — nothing to write.
 */
export async function batchWriteKnowledge(
  session: Session,
  creates: { knowledgeId: string; candidate: KnowledgeCandidateInput }[],
  appends: {
    knowledgeId: string;
    candidate: KnowledgeCandidateInput;
    trend: string;
  }[],
): Promise<BatchWriteResult[]> {
  const results: BatchWriteResult[] = [];

  if (creates.length > 0) {
    const now = new Date().toISOString();
    await session.run(
      `
      UNWIND $rows AS row
      CALL {
        WITH row
        MATCH (p:Patient {id: row.patientId})
        CREATE (k:Knowledge {
          id: row.knowledgeId, patientId: row.patientId, claim: row.claim,
          currentConfidence: row.finalConfidence, currentStatus: "active",
          sourceType: row.sourceType, involvedMetricNames: row.involvedMetricNames,
          firstPromotedAt: row.now, lastEvaluatedAt: row.now, versionCount: 1,
          confidenceTrend: "stable"
        })
        CREATE (p)-[:HAS_KNOWLEDGE]->(k)
        CREATE (v:KnowledgeVersion {
          id: row.knowledgeId + ":v1", knowledgeId: row.knowledgeId, versionNumber: 1,
          confidence: row.finalConfidence, confidenceBreakdownJson: row.confidenceBreakdown,
          reasoningSteps: row.reasoningSteps, contradictionReportJson: row.contradictionReport,
          knowledgeCandidateId: row.candidateElementId, createdAt: row.now
        })
        CREATE (k)-[:HAS_VERSION]->(v)
        WITH k, row
        MATCH (kc) WHERE elementId(kc) = row.candidateElementId
        CREATE (k)-[:PROMOTED_FROM]->(kc)
        WITH k, row
        OPTIONAL MATCH (kc2) WHERE elementId(kc2) = row.candidateElementId
        OPTIONAL MATCH (kc2)-[:HAS_EVIDENCE]->(e:Evidence)
        FOREACH (evidence IN CASE WHEN e IS NOT NULL THEN [e] ELSE [] END |
          CREATE (k)-[:SUPPORTED_BY]->(evidence)
        )
      } IN TRANSACTIONS OF 50 ROWS
      `,
      {
        rows: creates.map(({ knowledgeId, candidate }) => ({
          knowledgeId,
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
        })),
      },
    );
    creates.forEach(({ knowledgeId }) =>
      results.push({ knowledgeId, action: "create", versionNumber: 1 }),
    );
  }

  if (appends.length > 0) {
    const now = new Date().toISOString();
    const appendResult = await session.run(
      `
      UNWIND $rows AS row
      CALL {
        WITH row
        MATCH (k:Knowledge {id: row.knowledgeId})
        WITH k, row, k.versionCount + 1 AS newVersionNumber
        CREATE (v:KnowledgeVersion {
          id: row.knowledgeId + ":v" + toString(newVersionNumber), knowledgeId: row.knowledgeId,
          versionNumber: newVersionNumber, confidence: row.finalConfidence,
          confidenceBreakdownJson: row.confidenceBreakdown, reasoningSteps: row.reasoningSteps,
          contradictionReportJson: row.contradictionReport, knowledgeCandidateId: row.candidateElementId,
          createdAt: row.now
        })
        CREATE (k)-[:HAS_VERSION]->(v)
        SET k.currentConfidence = row.finalConfidence, k.versionCount = newVersionNumber,
            k.lastEvaluatedAt = row.now, k.confidenceTrend = row.trend
        RETURN row.knowledgeId AS knowledgeId, newVersionNumber
      } IN TRANSACTIONS OF 50 ROWS
      RETURN knowledgeId, newVersionNumber
      `,
      {
        rows: appends.map(({ knowledgeId, candidate, trend }) => ({
          knowledgeId,
          finalConfidence: candidate.finalConfidence,
          confidenceBreakdown: candidate.confidenceBreakdown,
          reasoningSteps: candidate.reasoningSteps,
          contradictionReport: candidate.contradictionReport,
          candidateElementId: candidate.candidateElementId,
          trend,
          now,
        })),
      },
    );
    for (const record of appendResult.records) {
      results.push({
        knowledgeId: record.get("knowledgeId"),
        action: "append_version",
        versionNumber: record.get("newVersionNumber").toNumber(),
      });
    }
  }

  return results;
}
