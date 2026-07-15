import { Hypothesis, HypothesisSourceType } from "./hypothesisFactory";
import { Evidence } from "./evidence";
import { ContradictionReport } from "./contradictionAnalyzer";

const ACCEPT_THRESHOLD = 0.5;
const MIN_SUPPORTING_TO_RESOLVE = 3; // must match contradictionAnalyzer.ts's constant

// Deliberately explicit, not inferred — each source's trustworthiness is
// a real design decision, not a byproduct of some other calculation.
const SOURCE_RELIABILITY: Record<HypothesisSourceType, number> = {
  legacy_correlation: 0.9, // numeric, confounder-aware — the most rigorous method already in the codebase
  legacy_association: 0.7, // categorical co-occurrence — less discriminating (lift=1 collapse we just observed)
  gnn_candidate: 0.6, // POC-stage model, finalLoss 0.56 — least-trusted source until retrained (M4.3 note)
};

export type KnowledgeStatus = "accepted" | "rejected" | "inconclusive";

export interface ConfidenceBreakdown {
  frequency: number;
  strength: number;
  consistency: number;
  recency: number;
  sourceReliabilityFactor: number;
  confounderPenalty: number;
  missingEvidencePenalty: number;
  finalConfidence: number;
}

export interface ScoredHypothesis {
  hypothesisId: string;
  status: KnowledgeStatus;
  confidenceBreakdown: ConfidenceBreakdown;
  reasoningSteps: string[];
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Combines Hypothesis + Evidence + ContradictionReport into a single,
 * auditable confidence score and accept/reject/inconclusive decision.
 *
 * Formula (Section 6 of the architecture review):
 *   confidence = (Frequency x Strength x Consistency x Recency)
 *                x SourceReliabilityFactor
 *                x (1 - ConfounderPenalty)
 *                x (1 - MissingEvidencePenalty)
 *
 * Status is decided BEFORE trusting the raw number: if there isn't enough
 * clean supporting evidence (contradictionReport.resolved === false), the
 * result is ALWAYS "inconclusive" — a low confidence score computed from
 * near-zero evidence must never be silently reinterpreted as "rejected".
 */
export function scoreHypothesis(
  hypothesis: Hypothesis,
  evidence: Evidence[],
  contradictionReport: ContradictionReport,
): ScoredHypothesis {
  const supporting = evidence.filter((e) => e.polarity === "supporting");

  const frequency = average(supporting.map((e) => e.frequency));
  const strength = average(supporting.map((e) => e.strength));
  const consistency = 1 - contradictionReport.evidenceWeight; // ties directly to observed contradiction ratio
  const recency = average(supporting.map((e) => e.recency));

  const sourceReliabilityFactor = SOURCE_RELIABILITY[hypothesis.sourceType];

  // Full penalty when unresolved (contradictions dominate), half penalty
  // when resolved despite some contradictions being present — mirrors
  // Section 5's "resolved" field meaning "outweighed, not absent."
  const confounderPenalty = contradictionReport.resolved
    ? contradictionReport.evidenceWeight * 0.5
    : contradictionReport.evidenceWeight;

  // Scales toward 1 (maximum penalty) as supportingCount approaches 0,
  // toward 0 (no penalty) once MIN_SUPPORTING_TO_RESOLVE is reached.
  const missingEvidencePenalty = Math.max(
    0,
    1 - contradictionReport.supportingCount / MIN_SUPPORTING_TO_RESOLVE,
  );

  const baseScore = frequency * strength * consistency * recency;
  const rawConfidence = baseScore * sourceReliabilityFactor;
  const finalConfidence =
    rawConfidence * (1 - confounderPenalty) * (1 - missingEvidencePenalty);

  const breakdown: ConfidenceBreakdown = {
    frequency,
    strength,
    consistency,
    recency,
    sourceReliabilityFactor,
    confounderPenalty,
    missingEvidencePenalty,
    finalConfidence,
  };

  const reasoningSteps: string[] = [
    `Collected ${evidence.length} evidence item(s): ${contradictionReport.supportingCount} supporting, ${contradictionReport.contradictingCount} contradicting.`,
    `Contradiction analysis: ${contradictionReport.explanation}`,
    `Base score (frequency x strength x consistency x recency): ${baseScore.toFixed(3)}`,
    `Source reliability factor for ${hypothesis.sourceType} applied: ${baseScore.toFixed(3)} x ${sourceReliabilityFactor} = ${rawConfidence.toFixed(3)}`,
    `Confounder penalty applied: -${(confounderPenalty * 100).toFixed(0)}%`,
    `Missing-evidence penalty applied: -${(missingEvidencePenalty * 100).toFixed(0)}%`,
    `Final confidence: ${finalConfidence.toFixed(3)}`,
  ];

  let status: KnowledgeStatus;
  if (!contradictionReport.resolved) {
    status = "inconclusive";
    reasoningSteps.push(
      `Status: INCONCLUSIVE — fewer than ${MIN_SUPPORTING_TO_RESOLVE} clean supporting observations. Not enough evidence to accept or reject.`,
    );
  } else if (finalConfidence >= ACCEPT_THRESHOLD) {
    status = "accepted";
    reasoningSteps.push(
      `Status: ACCEPTED — confidence ${finalConfidence.toFixed(3)} >= threshold ${ACCEPT_THRESHOLD}.`,
    );
  } else {
    status = "rejected";
    reasoningSteps.push(
      `Status: REJECTED — sufficient evidence was found, but confidence ${finalConfidence.toFixed(3)} < threshold ${ACCEPT_THRESHOLD}.`,
    );
  }

  return {
    hypothesisId: hypothesis.id,
    status,
    confidenceBreakdown: breakdown,
    reasoningSteps,
  };
}
