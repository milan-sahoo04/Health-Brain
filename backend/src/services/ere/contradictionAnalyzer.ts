import { Evidence } from "./evidence";

const MIN_SUPPORTING_TO_RESOLVE = 3; // matches correlationEngine's MIN_CLEAN_OBSERVATIONS_TO_SCORE

export type ContradictionType =
  | "confounder"
  | "counter_example"
  | "insufficient_consistency";
export type ContradictionSeverity = "low" | "moderate" | "high";

export interface ContradictionReport {
  hypothesisId: string;
  contradictionType: ContradictionType;
  severity: ContradictionSeverity;
  evidenceWeight: number; // 0-1, how much this should discount confidence
  explanation: string;
  resolved: boolean; // true if enough clean supporting evidence remains despite the contradiction
  priority: number;
  supportingCount: number;
  contradictingCount: number;
}

/**
 * Aggregates per-observation confounder flags (already computed by
 * correlateMetricPair, surfaced as individual Evidence items) into ONE
 * patient/hypothesis-level report — the structured summary Section 5
 * calls for, distinct from the raw per-item evidence list.
 */
export function analyzeContradictions(
  hypothesisId: string,
  evidence: Evidence[],
): ContradictionReport {
  const supporting = evidence.filter((e) => e.polarity === "supporting");
  const contradicting = evidence.filter((e) => e.polarity === "contradicting");

  const total = supporting.length + contradicting.length;
  const contradictionRatio = total > 0 ? contradicting.length / total : 0;

  const severity: ContradictionSeverity =
    contradictionRatio > 0.5
      ? "high"
      : contradictionRatio > 0.2
        ? "moderate"
        : "low";

  const resolved = supporting.length >= MIN_SUPPORTING_TO_RESOLVE;

  const contradictionType: ContradictionType =
    contradicting.length === 0
      ? "confounder" // no contradictions found — type is moot but kept for schema completeness
      : contradicting.some((e) => e.evidenceType === "confounder")
        ? "confounder"
        : "counter_example";

  return {
    hypothesisId,
    contradictionType,
    severity,
    evidenceWeight: contradictionRatio,
    explanation:
      contradicting.length === 0
        ? "No contradicting evidence found."
        : `Found ${contradicting.length} contradicting observation(s) out of ${total} total ` +
          `(${(contradictionRatio * 100).toFixed(0)}%). ${resolved ? "Sufficient clean supporting evidence remains." : "Insufficient clean supporting evidence remains."}`,
    resolved,
    priority: severity === "high" ? 1 : severity === "moderate" ? 2 : 3,
    supportingCount: supporting.length,
    contradictingCount: contradicting.length,
  };
}
