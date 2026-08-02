export interface SearchHit {
  sectionId: string;
  sectionKey: string | null;
  title: string | null;
  score: number;
}

const VECTOR_SERVICE_URL =
  process.env.VECTOR_SERVICE_URL ?? "http://localhost:8003";

const DEFAULT_TOP_K = 5;

/**
 * M9.3: thin client over M8's already-validated POST /search endpoint.
 * No new embedding logic here — reuses the exact vector-service contract
 * proven in M8.5-M8.8. Mirrors the fetch-based client pattern already
 * established in wikiEmbeddingClient.ts (M8.4), for consistency.
 *
 * Deliberately does NOT apply any relevance filtering here — per the
 * M8.8 finding, that's HybridRanker's (M9.4) responsibility, not the
 * vector retrieval layer's. This function returns raw top-K results,
 * including low-relevance ones; M9.4 decides what's usable.
 */
export async function retrieveCandidates(
  query: string,
  patientId: string,
  topK: number = DEFAULT_TOP_K,
): Promise<SearchHit[]> {
  const res = await fetch(`${VECTOR_SERVICE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, patientId, topK }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Vector search failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { results: SearchHit[] };
  return data.results;
}
