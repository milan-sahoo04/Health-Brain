import { withSession } from "../db/neo4j";
import {
  exportPatientGraph,
  PatientGraphExport,
} from "../db/queries/exportPatientGraph";

export interface PatientGraphBatch {
  patientId: string;
  nodes: PatientGraphExport["nodes"];
  edges: PatientGraphExport["edges"];
}

/**
 * Internal-only service — exports EVERY patient's subgraph for GNN
 * training. Deliberately not a route: this returns raw internal graph
 * data, which should never be reachable from the frontend or an
 * unauthenticated caller. Only trainGnnModel.ts calls this.
 *
 * Reuses exportPatientGraph.ts (M3) as-is — same reasoning as embeddingService.ts,
 * no duplicated Neo4j query logic.
 */
export async function exportAllPatientGraphs(): Promise<PatientGraphBatch[]> {
  const patientIds = await withSession(async (session) => {
    const result = await session.run(`MATCH (p:Patient) RETURN p.id AS id`);
    return result.records.map((r) => r.get("id") as string);
  });

  const batches: PatientGraphBatch[] = [];
  for (const patientId of patientIds) {
    const graph = await withSession((session) =>
      exportPatientGraph(session, patientId),
    );
    if (graph.nodes.length <= 1) continue; // skip patients with no events yet
    batches.push({ patientId, nodes: graph.nodes, edges: graph.edges });
  }
  return batches;
}
