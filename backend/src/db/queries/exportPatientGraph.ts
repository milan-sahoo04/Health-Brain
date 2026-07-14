import { Session } from "neo4j-driver";

export interface GraphNode {
  id: string; // elementId() — stable across dynamic event labels
  labels: string[];
  type: string | null;
  date: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  relType: string;
}

export interface PatientGraphExport {
  patientNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Exports one patient's subgraph in the shape the embedding service
 * consumes. Event nodes use dynamic labels (toSafeLabel), so we cannot
 * MATCH a fixed label — every event node has HAS_EVENT regardless of its
 * specific label, so we traverse via the relationship instead.
 *
 * Complexity: O(V + E) — one query, one pass over results, no per-node
 * round trips.
 */
export async function exportPatientGraph(
  session: Session,
  patientId: string,
): Promise<PatientGraphExport> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    OPTIONAL MATCH (p)-[:HAS_EVENT]->(e)
    RETURN
      elementId(p) AS patientNodeId,
      collect(DISTINCT {
        id: elementId(e),
        labels: labels(e),
        type: e.type,
        date: e.date
      }) AS eventNodes
    `,
    { patientId },
  );

  if (result.records.length === 0) {
    throw new Error(`Patient ${patientId} not found`);
  }

  const record = result.records[0];
  const patientNodeId = record.get("patientNodeId") as string;
  const rawEventNodes = record.get("eventNodes") as GraphNode[];
  const eventNodes = rawEventNodes.filter((n) => n.id !== null);

  const nodes: GraphNode[] = [
    { id: patientNodeId, labels: ["Patient"], type: "Patient", date: null },
    ...eventNodes,
  ];

  // Edges actually stored in Neo4j today.
  const edges: GraphEdge[] = eventNodes.map((n) => ({
    source: patientNodeId,
    target: n.id,
    relType: "HAS_EVENT",
  }));

  // Export-time-only enrichment (NOT persisted): chain same-type events
  // chronologically so the embedding model sees more than a pure star
  // topology. Grouping + sorting is O(n log n) per type — cheap at
  // per-patient scale.
  const byType = new Map<string, GraphNode[]>();
  for (const n of eventNodes) {
    const key = n.type ?? "Unknown";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(n);
  }
  for (const group of byType.values()) {
    const sorted = [...group].sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? ""),
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      edges.push({
        source: sorted[i].id,
        target: sorted[i + 1].id,
        relType: "SAME_TYPE_NEXT",
      });
    }
  }

  return { patientNodeId, nodes, edges };
}
