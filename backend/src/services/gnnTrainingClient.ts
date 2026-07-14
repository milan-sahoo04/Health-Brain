import { PatientGraphBatch } from "./graphExportService";

const GNN_SERVICE_URL = process.env.GNN_SERVICE_URL ?? "http://localhost:8002";

export interface TrainResult {
  modelVersion: string;
  datasetVersion: string;
  trainedAt: string;
  epochs: number;
  finalLoss: number;
  numNodes: number;
  numEdges: number;
  numPatients: number;
}

export async function triggerTraining(
  batches: PatientGraphBatch[],
  epochs = 100,
): Promise<TrainResult> {
  const res = await fetch(`${GNN_SERVICE_URL}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patients: batches.map((b) => ({
        patientId: b.patientId,
        nodes: b.nodes,
        edges: b.edges,
      })),
      epochs,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GNN training service error (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as TrainResult;
}
