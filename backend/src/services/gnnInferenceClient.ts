import { PatientGraphExport } from "../db/queries/exportPatientGraph";

const GNN_SERVICE_URL = process.env.GNN_SERVICE_URL ?? "http://localhost:8002";

export interface CandidatePrediction {
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  confidence: number;
  supportingNodes: string[];
  supportingEdges: { source: string; target: string; relType: string }[];
  explanation: string;
}

export interface InferResult {
  patientId: string;
  modelVersion: string;
  graphVersion: string;
  candidates: CandidatePrediction[];
  totalPairsScored: number;
  latencyMs: number;
}

export async function requestInference(
  patientId: string,
  graph: PatientGraphExport,
): Promise<InferResult> {
  const res = await fetch(`${GNN_SERVICE_URL}/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient: { patientId, nodes: graph.nodes, edges: graph.edges },
    }),
  });

  if (res.status === 503) {
    throw new Error(
      "No trained GNN model available yet — run training (M4.3) first",
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GNN inference error (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as InferResult;
}
