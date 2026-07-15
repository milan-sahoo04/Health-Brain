import { KnowledgeCandidateInput } from "../knowledgePromoter";

/**
 * Controlled test fixture matching the EXACT shape real :KnowledgeCandidate
 * nodes carry (per knowledgeCandidatePersistence.ts). Used to validate
 * promoteCandidate()'s logic without touching production thresholds or
 * live data — per the explicit decision to keep production behavior
 * unchanged while still proving M6.2's write path is correct.
 */
export function makeAcceptedCandidateFixture(
  overrides: Partial<KnowledgeCandidateInput> = {},
): KnowledgeCandidateInput {
  return {
    hypothesisId: "hyp:pattern:test-fixture-node-id",
    patientId: "test-patient-1", // must be a REAL patient in your Aura instance for the fixture test to run
    sourceType: "legacy_correlation",
    claim: "Walking is correlated with HbA1c",
    direction: "inverse",
    priorConfidence: 0.85,
    involvedMetricNames: ["Walking", "HbA1c"],
    status: "accepted",
    finalConfidence: 0.72,
    confidenceBreakdown: JSON.stringify({
      frequency: 0.9,
      strength: 0.8,
      consistency: 0.95,
      recency: 0.9,
      sourceReliabilityFactor: 0.9,
      confounderPenalty: 0,
      missingEvidencePenalty: 0,
      finalConfidence: 0.72,
    }),
    reasoningSteps: [
      "Collected 8 evidence item(s): 8 supporting, 0 contradicting.",
      "Status: ACCEPTED (fixture) — for M6.2 validation only.",
    ],
    contradictionReport: JSON.stringify({
      hypothesisId: "hyp:pattern:test-fixture-node-id",
      contradictionType: "confounder",
      severity: "low",
      evidenceWeight: 0,
      explanation: "No contradicting evidence found.",
      resolved: true,
      priority: 3,
      supportingCount: 8,
      contradictingCount: 0,
    }),
    candidateElementId: "", // must be set to a REAL :KnowledgeCandidate elementId at test time — see below
    ...overrides,
  };
}
