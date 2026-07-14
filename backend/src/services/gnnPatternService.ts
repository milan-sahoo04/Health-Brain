import { withSession } from "../db/neo4j";
import { exportPatientGraph } from "../db/queries/exportPatientGraph";
import { requestInference } from "./gnnInferenceClient";
import {
  persistAllCandidates,
  PersistedCandidateSummary,
} from "../db/queries/patternCandidatePersistence";

export interface GnnPatternRunSummary {
  patientId: string;
  modelVersion: string;
  totalPairsScored: number;
  candidatesFound: number;
  activeCount: number;
  candidates: PersistedCandidateSummary[];
}

export async function discoverPatientPatterns(
  patientId: string,
): Promise<GnnPatternRunSummary> {
  const graph = await withSession((session) =>
    exportPatientGraph(session, patientId),
  );

  if (graph.nodes.length <= 1) {
    return {
      patientId,
      modelVersion: "none",
      totalPairsScored: 0,
      candidatesFound: 0,
      activeCount: 0,
      candidates: [],
    };
  }

  const result = await requestInference(patientId, graph);

  const summaries = await withSession((session) =>
    persistAllCandidates(
      session,
      patientId,
      result.modelVersion,
      result.graphVersion,
      result.candidates,
    ),
  );

  return {
    patientId,
    modelVersion: result.modelVersion,
    totalPairsScored: result.totalPairsScored,
    candidatesFound: result.candidates.length,
    activeCount: summaries.filter((s) => s.status === "active").length,
    candidates: summaries,
  };
}
