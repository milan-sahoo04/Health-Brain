import { Session } from "neo4j-driver";
import { KnowledgeCandidateInput } from "./knowledgePromoter";
import { computeKnowledgeId } from "./knowledgeTypes";
import {
  VersioningPolicy,
  DEFAULT_VERSIONING_POLICY,
  isSignificantChange,
} from "./versioningPolicy";

export type VersioningDecision =
  | { action: "create"; knowledgeId: string }
  | {
      action: "append_version";
      knowledgeId: string;
      delta: number;
      trend: "improving" | "declining" | "stable";
    }
  | { action: "no_op"; knowledgeId: string; delta: number };

/**
 * M6.3.a scope: READ-ONLY. Decides what WOULD happen for a given
 * candidate without writing anything. The actual write (single
 * transaction, per the approved architecture) is M6.3.b.
 *
 * Trend uses only the two most recent KnowledgeVersion entries — per the
 * approved architecture, not a full-history regression, since
 * KnowledgeVersion entries are already pre-filtered to "material changes
 * only," making a longer window statistically meaningless at realistic
 * version counts.
 */
export async function decideVersioningAction(
  session: Session,
  candidate: KnowledgeCandidateInput,
  policy: VersioningPolicy = DEFAULT_VERSIONING_POLICY,
): Promise<VersioningDecision> {
  const knowledgeId = computeKnowledgeId(
    candidate.patientId,
    candidate.hypothesisId,
  );

  const existing = await session.run(
    `MATCH (k:Knowledge {id: $knowledgeId}) RETURN k.currentConfidence AS currentConfidence`,
    { knowledgeId },
  );

  if (existing.records.length === 0) {
    return { action: "create", knowledgeId };
  }

  const currentConfidence = existing.records[0].get(
    "currentConfidence",
  ) as number;
  const { significant, delta } = isSignificantChange(
    currentConfidence,
    candidate.finalConfidence,
    policy,
  );

  if (!significant) {
    return { action: "no_op", knowledgeId, delta };
  }

  const trend =
    candidate.finalConfidence > currentConfidence
      ? "improving"
      : candidate.finalConfidence < currentConfidence
        ? "declining"
        : "stable";

  return { action: "append_version", knowledgeId, delta, trend };
}

export interface BatchedDecisionRow {
  candidate: KnowledgeCandidateInput;
  knowledgeId: string;
  exists: boolean;
  currentConfidence: number | null;
  versionCount: number | null;
}

/**
 * M6.4.a: batched equivalent of decideVersioningAction's READ step.
 * ONE round trip for N candidates, instead of N round trips. The
 * significance/trend DECISION itself still happens per-row in
 * TypeScript afterward (isSignificantChange is a pure function, cheap,
 * and must stay per-candidate — only the Neo4j round trip is batched).
 *
 * Deduplicates by hypothesisId before querying, per the architecture
 * review's Section 5 (idempotency): if the same hypothesisId appears
 * twice in one batch, only the first is kept, removing any ambiguity
 * about which row "wins" a same-id CREATE race.
 */
export async function batchReadKnowledgeState(
  session: Session,
  candidates: KnowledgeCandidateInput[],
): Promise<BatchedDecisionRow[]> {
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.hypothesisId)) return false;
    seen.add(c.hypothesisId);
    return true;
  });

  const withIds = deduped.map((c) => ({
    candidate: c,
    knowledgeId: computeKnowledgeId(c.patientId, c.hypothesisId),
  }));

  if (withIds.length === 0) return [];

  const result = await session.run(
    `
    UNWIND $rows AS row
    OPTIONAL MATCH (k:Knowledge {id: row.knowledgeId})
    RETURN row.knowledgeId AS knowledgeId, k.currentConfidence AS currentConfidence, k.versionCount AS versionCount
    `,
    { rows: withIds.map((w) => ({ knowledgeId: w.knowledgeId })) },
  );

  const stateByKnowledgeId = new Map<
    string,
    { currentConfidence: number | null; versionCount: number | null }
  >();
  for (const record of result.records) {
    stateByKnowledgeId.set(record.get("knowledgeId"), {
      currentConfidence: record.get("currentConfidence"),
      versionCount:
        record.get("versionCount")?.toNumber?.() ?? record.get("versionCount"),
    });
  }

  return withIds.map(({ candidate, knowledgeId }) => {
    const state = stateByKnowledgeId.get(knowledgeId);
    return {
      candidate,
      knowledgeId,
      exists: state?.currentConfidence != null,
      currentConfidence: state?.currentConfidence ?? null,
      versionCount: state?.versionCount ?? null,
    };
  });
}
