import { PatientGraphExport } from "../db/queries/exportPatientGraph";

const EMBEDDING_SERVICE_URL =
  process.env.EMBEDDING_SERVICE_URL ?? "http://localhost:8001";

export interface EmbeddingResponse {
  embeddings: Record<string, number[]>;
  dimensions: number;
}

/**
 * Thin client to the Python embedding microservice. Node never gets a
 * graph-ML dependency of its own — it stays the orchestrator.
 * Uses global fetch (Node 18+), so no new npm dependency is required.
 */
export async function requestEmbeddings(
  graph: PatientGraphExport,
): Promise<EmbeddingResponse> {
  const res = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: graph.nodes, edges: graph.edges }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Embedding service error (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as EmbeddingResponse;
}
