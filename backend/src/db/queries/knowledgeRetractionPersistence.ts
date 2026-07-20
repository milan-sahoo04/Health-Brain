import { Session } from "neo4j-driver";

export interface RetractionResult {
  knowledgeId: string;
  action: "retracted" | "already_retracted_same_reason" | "reason_updated";
  versionNumber?: number;
}

/**
 * M6.5.a: retracts a Knowledge node. Single transaction — reads current
 * status/versionCount AND writes the new state AND (when needed) appends
 * a version, all in one Cypher execution, same race-condition-safe
 * pattern as appendKnowledgeVersion (M6.3.b).
 *
 * Idempotency (per the approved architecture, Section 7):
 *   - not yet retracted            -> retract, append final version
 *   - already retracted, SAME reason    -> no-op, no new version, no field changes
 *   - already retracted, DIFFERENT reason -> update retractionReason only,
 *                                            no new version (the fact of
 *                                            retraction hasn't changed)
 */
export async function retractKnowledge(
  session: Session,
  knowledgeId: string,
  reason: string,
): Promise<RetractionResult> {
  const now = new Date().toISOString();

  const result = await session.run(
    `
    MATCH (k:Knowledge {id: $knowledgeId})
WITH k,
     k.currentStatus AS priorStatus,
     k.retractionReason AS priorReason,
     k.versionCount + 1 AS nextVersionNumber
FOREACH (_ IN CASE WHEN priorStatus <> "retracted" THEN [1] ELSE [] END |
  SET k.currentStatus = "retracted",
      k.retractedAt = $now,
      k.retractionReason = $reason,
      k.versionCount = nextVersionNumber,
      k.lastEvaluatedAt = $now
)
FOREACH (_ IN CASE WHEN priorStatus = "retracted" AND priorReason <> $reason THEN [1] ELSE [] END |
  SET k.retractionReason = $reason
)
FOREACH (_ IN CASE WHEN priorStatus <> "retracted" THEN [1] ELSE [] END |
  CREATE (v:KnowledgeVersion {
    id: $knowledgeId + ":v" + toString(nextVersionNumber),
    knowledgeId: $knowledgeId,
    versionNumber: nextVersionNumber,
    confidence: k.currentConfidence,
    confidenceBreakdownJson: null,
    reasoningSteps: ["Knowledge retracted: " + $reason],
    contradictionReportJson: null,
    knowledgeCandidateId: null,
    retractionReason: $reason,
    createdAt: $now
  })
  CREATE (k)-[:HAS_VERSION]->(v)
)
RETURN
  k.versionCount AS versionCount,
  priorStatus AS priorStatus,
  priorReason AS priorReason
    `,
    { knowledgeId, reason, now },
  );

  if (result.records.length === 0) {
    throw new Error(`retractKnowledge: Knowledge ${knowledgeId} not found`);
  }

  const record = result.records[0];
  const priorStatus: string = record.get("priorStatus");
  const priorReason: string | null = record.get("priorReason");

  if (priorStatus !== "retracted") {
    return {
      knowledgeId,
      action: "retracted",
      versionNumber: record.get("versionCount").toNumber(),
    };
  }
  if (priorReason === reason) {
    return { knowledgeId, action: "already_retracted_same_reason" };
  }
  return { knowledgeId, action: "reason_updated" };
}

export interface ReactivationResult {
  knowledgeId: string;
  action: "reactivated" | "already_active";
  versionNumber?: number;
}

/**
 * M6.5.b: reverses a retraction. Same single-transaction, same-FOREACH-
 * block discipline as retractKnowledge — the CREATE and its HAS_VERSION
 * relationship live in the SAME FOREACH, per the bug fixed in M6.5.a.
 *
 * Idempotent: reactivating an already-active node is a no-op success,
 * not an error.
 */
export async function reactivateKnowledge(
  session: Session,
  knowledgeId: string,
  reason: string,
): Promise<ReactivationResult> {
  const now = new Date().toISOString();

  const result = await session.run(
    `
    MATCH (k:Knowledge {id: $knowledgeId})
    WITH k, k.currentStatus AS priorStatus, k.versionCount + 1 AS nextVersionNumber
    FOREACH (_ IN CASE WHEN priorStatus = "retracted" THEN [1] ELSE [] END |
      SET k.currentStatus = "active",
          k.retractedAt = null,
          k.retractionReason = null,
          k.versionCount = nextVersionNumber,
          k.lastEvaluatedAt = $now
    )
    FOREACH (_ IN CASE WHEN priorStatus = "retracted" THEN [1] ELSE [] END |
      CREATE (v:KnowledgeVersion {
        id: $knowledgeId + ":v" + toString(nextVersionNumber),
        knowledgeId: $knowledgeId,
        versionNumber: nextVersionNumber,
        confidence: k.currentConfidence,
        confidenceBreakdownJson: null,
        reasoningSteps: ["Knowledge reactivated: " + $reason],
        contradictionReportJson: null,
        knowledgeCandidateId: null,
        retractionReason: null,
        createdAt: $now
      })
      CREATE (k)-[:HAS_VERSION]->(v)
    )
    RETURN k.versionCount AS versionCount, priorStatus AS priorStatus
    `,
    { knowledgeId, reason, now },
  );

  if (result.records.length === 0) {
    throw new Error(`reactivateKnowledge: Knowledge ${knowledgeId} not found`);
  }

  const record = result.records[0];
  const priorStatus: string = record.get("priorStatus");

  return priorStatus === "retracted"
    ? {
        knowledgeId,
        action: "reactivated",
        versionNumber: record.get("versionCount").toNumber(),
      }
    : { knowledgeId, action: "already_active" };
}
