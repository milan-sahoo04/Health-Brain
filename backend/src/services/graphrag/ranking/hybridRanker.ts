import { SearchHit } from "../retrievers/vectorRetriever";
import { RetrievedKnowledge } from "../graph/graphTraverser";

export interface ScoreBreakdown {
  vectorScore: number;
  confidenceScore: number;
  evidenceScore: number;
  recencyScore: number;
  distanceScore: number;
}

export interface RankedItem {
  knowledge: RetrievedKnowledge;
  finalScore: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface RankedResult {
  status: "ok" | "no_relevant_context";
  results: RankedItem[];
}

export interface RankingWeights {
  vector: number;
  confidence: number;
  evidence: number;
  recency: number;
  distance: number;
}

// Stage 2 weights — now purely about ORDERING already-relevant items,
// not about deciding relevance. Vector still included so the strongest
// semantic match among relevant items is still favored, but it no
// longer has to single-handedly overcome high-confidence-but-weaker-
// match items the way it did in the single-stage design.
export const DEFAULT_WEIGHTS: RankingWeights = {
  vector: 0.4,
  confidence: 0.3,
  evidence: 0.15,
  recency: 0.1,
  distance: 0.05,
};

// Stage 1 gate — the ONLY thing that decides relevance. Chosen
// provisionally from M8.8's observed score ranges (relevant: 0.51-0.57,
// irrelevant: 0.28-0.32) to sit between them. Needs real tuning against
// a larger, more varied query/patient set before being treated as final.
export const DEFAULT_MIN_VECTOR_THRESHOLD = 0.45;

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function computeVectorScore(
  k: RetrievedKnowledge,
  scoreBySectionId: Map<string, number>,
): number {
  const sectionScores = k.sourceSectionIds
    .map((id) => scoreBySectionId.get(id))
    .filter((s): s is number => s !== undefined);
  return sectionScores.length > 0 ? Math.max(...sectionScores) : 0;
}

/**
 * M9.4 (revised): two-stage pipeline, per the separation-of-concerns
 * finding — vector similarity is the ONLY relevance signal (Stage 1);
 * confidence/evidence/recency/distance only refine ORDERING among
 * already-relevant items (Stage 2). This prevents a high-quality but
 * query-irrelevant Knowledge item from outscoring a genuinely relevant
 * one, which the original single-formula design allowed.
 */
export function rankKnowledge(
  retrieved: RetrievedKnowledge[],
  searchHits: SearchHit[],
  weights: RankingWeights = DEFAULT_WEIGHTS,
  minVectorThreshold: number = DEFAULT_MIN_VECTOR_THRESHOLD,
): RankedResult {
  const scoreBySectionId = new Map<string, number>();
  for (const hit of searchHits) {
    scoreBySectionId.set(hit.sectionId, hit.score);
  }

  // --- Stage 1: Relevance Gate ---
  // Vector score ONLY. Nothing graph-derived can pass an item that
  // fails here, and nothing graph-derived is needed to pass one that
  // clears it — relevance is decided before quality is ever consulted.
  const relevant = retrieved.filter(
    (k) => computeVectorScore(k, scoreBySectionId) >= minVectorThreshold,
  );

  if (relevant.length === 0) {
    return { status: "no_relevant_context", results: [] };
  }

  // --- Stage 2: Hybrid Ranking ---
  // Only runs on items that already passed Stage 1. These signals now
  // only affect ORDER, never inclusion/exclusion.
  const scored: RankedItem[] = relevant.map((k) => {
    const vectorScore = computeVectorScore(k, scoreBySectionId);
    const confidenceScore = k.currentConfidence;
    const evidenceScore = average(k.evidence.map((e) => e.strength));
    const recencyScore = average(k.evidence.map((e) => e.recency));
    const distanceScore = 1.0; // 1-hop only for now

    const finalScore =
      vectorScore * weights.vector +
      confidenceScore * weights.confidence +
      evidenceScore * weights.evidence +
      recencyScore * weights.recency +
      distanceScore * weights.distance;

    return {
      knowledge: k,
      finalScore,
      scoreBreakdown: {
        vectorScore,
        confidenceScore,
        evidenceScore,
        recencyScore,
        distanceScore,
      },
    };
  });

  const sorted = scored.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return b.knowledge.lastEvaluatedAt.localeCompare(
      a.knowledge.lastEvaluatedAt,
    );
  });

  return { status: "ok", results: sorted };
}
