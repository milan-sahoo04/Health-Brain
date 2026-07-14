import { Session } from "neo4j-driver";

export interface EmbeddingWriteSummary {
  nodesUpdated: number;
  dimensions: number;
}

/**
 * Batched write-back — ONE round trip via UNWIND regardless of graph size
 * (O(V) work inside Neo4j), instead of one SET per node. Matches by
 * elementId so it works uniformly across dynamic event labels without a
 * label-specific query per event type. Mirrors patternPersistence.ts's
 * coalesce-on-createdAt convention for consistency with the rest of the
 * codebase.
 */
export async function writeEmbeddings(
  session: Session,
  embeddings: Record<string, number[]>,
): Promise<EmbeddingWriteSummary> {
  const entries = Object.entries(embeddings).map(([nodeId, vector]) => ({
    nodeId,
    vector,
  }));
  if (entries.length === 0) return { nodesUpdated: 0, dimensions: 0 };

  const now = new Date().toISOString();

  await session.run(
    `
    UNWIND $entries AS entry
    MATCH (n) WHERE elementId(n) = entry.nodeId
    SET
      n.embedding = entry.vector,
      n.embeddingUpdatedAt = $now,
      n.embeddingCreatedAt = coalesce(n.embeddingCreatedAt, $now)
    `,
    { entries, now },
  );

  return { nodesUpdated: entries.length, dimensions: entries[0].vector.length };
}
