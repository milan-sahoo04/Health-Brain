import { Session } from "neo4j-driver";
import { computeKnowledgeId } from "./knowledgeTypes";
import { createKnowledge } from "../../db/queries/knowledgePersistence";
import { appendKnowledgeVersion } from "../../db/queries/knowledgeVersionPersistence";
import { decideVersioningAction } from "./knowledgeVersioning";
import {
  VersioningPolicy,
  DEFAULT_VERSIONING_POLICY,
} from "./versioningPolicy";

import { batchReadKnowledgeState } from "./knowledgeVersioning";
import {
  batchWriteKnowledge,
  BatchWriteResult,
} from "../../db/queries/knowledgeBatchPersistence";
import { isSignificantChange } from "./versioningPolicy";

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
 *
 * NOTE: retained unchanged for backward compatibility with the M6.2
 * fixture test (/test-promotion). promoteOrVersionCandidate() below is
 * the real production entrypoint as of M6.3.b — this function is no
 * longer called from production code, but is left exactly as verified
 * since Rule 2 (don't modify working, tested code without cause) applies
 * here just as much as everywhere else in this project.
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

export interface PromotionOutcome {
  knowledgeId: string;
  action: "create" | "append_version" | "no_op";
  versionNumber?: number;
}

/**
 * M6.3.b scope: the REAL production promotion entrypoint. Routes to
 * create (M6.2's createKnowledge, reused as-is) or append (M6.3.b's
 * appendKnowledgeVersion, single-transaction) based on
 * decideVersioningAction()'s read-only decision (M6.3.a). Supersedes
 * promoteCandidate() above for all real use, without deleting or
 * modifying it.
 */
export async function promoteOrVersionCandidate(
  session: Session,
  candidate: KnowledgeCandidateInput,
  policy: VersioningPolicy = DEFAULT_VERSIONING_POLICY,
): Promise<PromotionOutcome> {
  if (candidate.status !== "accepted") {
    throw new Error(
      `Cannot promote candidate with status "${candidate.status}" — only "accepted" candidates may be promoted.`,
    );
  }

  const decision = await decideVersioningAction(session, candidate, policy);

  if (decision.action === "create") {
    const knowledgeId = computeKnowledgeId(
      candidate.patientId,
      candidate.hypothesisId,
    );
    await createKnowledge(session, knowledgeId, candidate);
    return { knowledgeId, action: "create", versionNumber: 1 };
  }

  if (decision.action === "append_version") {
    const { newVersionNumber } = await appendKnowledgeVersion(
      session,
      decision.knowledgeId,
      candidate,
      decision.trend,
    );
    return {
      knowledgeId: decision.knowledgeId,
      action: "append_version",
      versionNumber: newVersionNumber,
    };
  }

  // no_op — confidence change wasn't material enough to warrant a new version
  return { knowledgeId: decision.knowledgeId, action: "no_op" };
}

export async function promoteOrVersionCandidatesBatch(
  session: Session,
  candidates: KnowledgeCandidateInput[],
  policy: VersioningPolicy = DEFAULT_VERSIONING_POLICY,
) {
  const rows = await batchReadKnowledgeState(session, candidates);

  const creates: { knowledgeId: string; candidate: KnowledgeCandidateInput }[] =
    [];
  const appends: {
    knowledgeId: string;
    candidate: KnowledgeCandidateInput;
    trend: string;
  }[] = [];
  const noOps: string[] = [];

  for (const row of rows) {
    if (!row.exists) {
      creates.push({ knowledgeId: row.knowledgeId, candidate: row.candidate });
      continue;
    }
    const { significant } = isSignificantChange(
      row.currentConfidence!,
      row.candidate.finalConfidence,
      policy,
    );
    if (!significant) {
      noOps.push(row.knowledgeId);
      continue;
    }
    const trend =
      row.candidate.finalConfidence > row.currentConfidence!
        ? "improving"
        : row.candidate.finalConfidence < row.currentConfidence!
          ? "declining"
          : "stable";
    appends.push({
      knowledgeId: row.knowledgeId,
      candidate: row.candidate,
      trend,
    });
  }

  const writeResults = await batchWriteKnowledge(session, creates, appends);
  noOps.forEach((knowledgeId) =>
    writeResults.push({ knowledgeId, action: "no_op" }),
  );
  return writeResults;
}
// --- add to existing file ---
export interface PatientPromotionSummary {
  patientId: string;
  acceptedCandidateCount: number;
  results: BatchWriteResult[]; // from knowledgeBatchPersistence.ts
  byAction: { create: number; append_version: number; no_op: number };
}

/**
 * M6.6.a: the REAL production entrypoint — reads a patient's actual
 * accepted :KnowledgeCandidate nodes from Neo4j (not a fixture) and
 * promotes them via the batched, scale-validated path (M6.4).
 *
 * This was the missing piece: every prior route either previewed
 * (read-only) or tested (fixture-based). This is the first route that
 * does real work against real M5 output.
 */
export async function promotePatientKnowledge(
  session: Session,
  patientId: string,
  policy: VersioningPolicy = DEFAULT_VERSIONING_POLICY,
): Promise<PatientPromotionSummary> {
  const candidatesResult = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate)
    WHERE kc.status = "accepted"
    RETURN kc, elementId(kc) AS candidateElementId
    `,
    { patientId },
  );

  const candidates: KnowledgeCandidateInput[] = candidatesResult.records.map(
    (r) => {
      const kc = r.get("kc").properties;
      return {
        hypothesisId: kc.hypothesisId,
        patientId,
        sourceType: kc.sourceType,
        claim: kc.claim,
        direction: kc.direction,
        priorConfidence: kc.priorConfidence,
        involvedMetricNames: kc.involvedMetricNames,
        status: kc.status,
        finalConfidence: kc.finalConfidence,
        confidenceBreakdown: kc.confidenceBreakdown,
        reasoningSteps: kc.reasoningSteps,
        contradictionReport: kc.contradictionReport,
        candidateElementId: r.get("candidateElementId"),
      };
    },
  );

  if (candidates.length === 0) {
    return {
      patientId,
      acceptedCandidateCount: 0,
      results: [],
      byAction: { create: 0, append_version: 0, no_op: 0 },
    };
  }

  const results = await promoteOrVersionCandidatesBatch(
    session,
    candidates,
    policy,
  );

  return {
    patientId,
    acceptedCandidateCount: candidates.length,
    results,
    byAction: {
      create: results.filter((r) => r.action === "create").length,
      append_version: results.filter((r) => r.action === "append_version")
        .length,
      no_op: results.filter((r) => r.action === "no_op").length,
    },
  };
}
