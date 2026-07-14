import { withSession } from "../db/neo4j";
import { exportPatientGraph } from "../db/queries/exportPatientGraph";
import { requestEmbeddings } from "./embeddingClient";
import { writeEmbeddings, EmbeddingWriteSummary } from "./embeddingWriter";

/**
 * Full M3 pipeline for one patient: export -> embed -> write back.
 * Single call site so the route (Step E) and, later, any scheduler have
 * one thing to call.
 */
export async function refreshPatientEmbeddings(
  patientId: string,
): Promise<EmbeddingWriteSummary> {
  const graph = await withSession((session) =>
    exportPatientGraph(session, patientId),
  );

  if (graph.nodes.length <= 1) {
    return { nodesUpdated: 0, dimensions: 0 }; // nothing to embed yet
  }

  const { embeddings } = await requestEmbeddings(graph);
  return withSession((session) => writeEmbeddings(session, embeddings));
}
