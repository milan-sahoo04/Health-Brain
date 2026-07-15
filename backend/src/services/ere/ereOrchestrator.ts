import { withSession } from "../../db/neo4j";
import { buildHypothesesForPatient } from "./hypothesisFactory";
import { collectEvidenceForHypothesis } from "./evidenceCollector";
import { analyzeContradictions } from "./contradictionAnalyzer";
import { scoreHypothesis } from "./confidenceScorer";
import {
  persistKnowledgeCandidate,
  PersistedKnowledgeCandidateSummary,
} from "../../db/queries/knowledgeCandidatePersistence";

export interface ErePipelineSummary {
  patientId: string;
  hypothesesEvaluated: number;
  byStatus: { accepted: number; rejected: number; inconclusive: number };
  candidates: PersistedKnowledgeCandidateSummary[];
}

/**
 * Runs the FULL M5 pipeline for one patient: Hypothesis -> Evidence ->
 * Contradiction -> Confidence -> persisted KnowledgeCandidate. This is
 * the single call site the route (M5.5) will use — same shape as
 * eventsRouter's /synthesize orchestrating Phase B+C in events.ts.
 */
export async function runEvidenceReasoningEngine(
  patientId: string,
): Promise<ErePipelineSummary> {
  const hypotheses = await withSession((session) =>
    buildHypothesesForPatient(session, patientId),
  );

  const candidates: PersistedKnowledgeCandidateSummary[] = [];

  for (const hypothesis of hypotheses) {
    const evidence = await withSession((session) =>
      collectEvidenceForHypothesis(session, hypothesis),
    );
    const contradictionReport = analyzeContradictions(hypothesis.id, evidence);
    const scored = scoreHypothesis(hypothesis, evidence, contradictionReport);

    const summary = await withSession((session) =>
      persistKnowledgeCandidate(
        session,
        hypothesis,
        evidence,
        contradictionReport,
        scored,
      ),
    );
    candidates.push(summary);
  }

  return {
    patientId,
    hypothesesEvaluated: hypotheses.length,
    byStatus: {
      accepted: candidates.filter((c) => c.status === "accepted").length,
      rejected: candidates.filter((c) => c.status === "rejected").length,
      inconclusive: candidates.filter((c) => c.status === "inconclusive")
        .length,
    },
    candidates,
  };
}
