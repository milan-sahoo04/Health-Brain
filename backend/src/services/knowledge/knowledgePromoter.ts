import { Session } from "neo4j-driver";
import { computeKnowledgeId } from "./knowledgeTypes";
import { createKnowledge } from "../../db/queries/knowledgePersistence";

export interface PromotionPreviewItem {
  knowledgeCandidateId: string;
  hypothesisId: string;
  computedKnowledgeId: string;
  claim: string;
  finalConfidence: number;
  sourceType: string;
  wouldCreateNew: boolean; // true if no Knowledge with this id exists yet — always true until M6.2 ships
}

/**
 * M6.1 scope: reads accepted KnowledgeCandidates for a patient, computes
 * what their deterministic Knowledge id WOULD be, and checks (read-only)
 * whether a Knowledge node with that id already exists. Performs NO
 * writes — CREATE/version-append logic is M6.2/M6.3.
 *
 * This exists to validate the id scheme against real data before any
 * promotion logic depends on it being correct.
 */
export async function previewPromotion(
  session: Session,
  patientId: string,
): Promise<PromotionPreviewItem[]> {
  const candidatesResult = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate)
    WHERE kc.status = "accepted"
    RETURN kc, elementId(kc) AS candidateId
    `,
    { patientId },
  );

  const previews: PromotionPreviewItem[] = [];

  for (const record of candidatesResult.records) {
    const kc = record.get("kc").properties;
    const candidateId: string = record.get("candidateId");
    const hypothesisId: string = kc.hypothesisId;
    const knowledgeId = computeKnowledgeId(patientId, hypothesisId);

    // Sequential, one query per candidate — deliberately simple for M6.1's
    // read-only verification purpose. M6.4's batched writer will replace
    // this pattern once actual writes are involved (per the M6 architecture
    // review's Step 10, addressing the patient-3 1,035-candidate finding).
    const existingResult = await session.run(
      `MATCH (k:Knowledge {id: $knowledgeId}) RETURN k`,
      { knowledgeId },
    );

    previews.push({
      knowledgeCandidateId: candidateId,
      hypothesisId,
      computedKnowledgeId: knowledgeId,
      claim: kc.claim,
      finalConfidence: kc.finalConfidence,
      sourceType: kc.sourceType,
      wouldCreateNew: existingResult.records.length === 0,
    });
  }

  return previews;
}

export interface KnowledgeCandidateInput {
  // Exact shape read back from :KnowledgeCandidate nodes (knowledgeCandidatePersistence.ts) —
  // used identically whether sourced from a live Neo4j query or a test fixture.
  hypothesisId: string;
  patientId: string;
  sourceType: string;
  claim: string;
  direction: string;
  priorConfidence: number;
  involvedMetricNames: [string, string];
  status: string;
  finalConfidence: number;
  confidenceBreakdown: string; // JSON string, as persisted
  reasoningSteps: string[];
  contradictionReport: string; // JSON string, as persisted
  candidateElementId: string; // for PROMOTED_FROM linkage
}

export interface PromotionResult {
  knowledgeId: string;
  created: boolean; // true = first-time CREATE (M6.2 scope); false reserved for M6.3's version-append case
}

/**
 * M6.2 scope: first-time promotion ONLY. If a Knowledge node with this
 * deterministic id already exists, this throws rather than silently
 * doing nothing or overwriting — version-append logic (the correct
 * handling of a pre-existing Knowledge) is explicitly M6.3's job, not
 * built yet. This boundary is deliberate, not an oversight.
 */
export async function promoteCandidate(
  session: Session,
  candidate: KnowledgeCandidateInput,
): Promise<PromotionResult> {
  if (candidate.status !== "accepted") {
    throw new Error(
      `Cannot promote candidate with status "${candidate.status}" — only "accepted" candidates may be promoted.`,
    );
  }

  const knowledgeId = computeKnowledgeId(
    candidate.patientId,
    candidate.hypothesisId,
  );

  const existing = await session.run(
    `MATCH (k:Knowledge {id: $knowledgeId}) RETURN k`,
    { knowledgeId },
  );
  if (existing.records.length > 0) {
    throw new Error(
      `Knowledge ${knowledgeId} already exists — first-time promotion (M6.2) does not handle re-promotion. That's M6.3's version-append logic.`,
    );
  }

  await createKnowledge(session, knowledgeId, candidate);

  return { knowledgeId, created: true };
}
