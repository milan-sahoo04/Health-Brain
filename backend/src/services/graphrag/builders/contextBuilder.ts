import { RankedResult, RankedItem } from "../ranking/hybridRanker";
import { SearchHit } from "../retrievers/vectorRetriever";

export interface ContextProvenance {
  wikiSectionIds: string[];
  knowledgeId: string;
  evidenceIds: string[];
}

export interface ContextEvidenceItem {
  id: string;
  description: string;
  polarity: string;
  strength: number;
  recency: number;
}

export interface ContextKnowledgeItem {
  knowledgeId: string;
  claim: string;
  confidence: number;
  confidenceTrend: string;
  hybridScore: number;
  sourceSections: string[];
  evidence: ContextEvidenceItem[];
  provenance: ContextProvenance;
}

export interface SummaryStatistics {
  retrievedKnowledgeCount: number;
  retrievedEvidenceCount: number;
  truncated: boolean; // Items removed due to budget
  budgetExceeded: boolean; // Final context still exceeds budget
  totalContextSize: number;
}

export interface RetrievalMetadata {
  retrievalTimeMs: number;
  vectorCandidates: number;
  graphExpansionCount: number;
  rankingVersion: string;
}

export interface RetrievalContext {
  query: string;
  patientId: string;
  status: "ok" | "no_relevant_context";
  rankedKnowledge: ContextKnowledgeItem[];
  summaryStatistics: SummaryStatistics;
  retrievalMetadata: RetrievalMetadata;
}

const RANKING_VERSION = "m9.4-two-stage-v1";
export const DEFAULT_CHARACTER_BUDGET = 8000;

/**
 * M9.5: pure transformation layer. Takes M9.4's already-gated, already-
 * ranked RankedResult and reshapes it into the final RetrievalContext
 * contract M10 consumes directly. Performs NO Neo4j/Qdrant access — all
 * data was already fetched and validated upstream (M9.2/M9.3/M9.4).
 *
 * Deterministic: identical inputs always produce identical output. No
 * randomness, no wall-clock-dependent ordering (retrievalTimeMs is
 * recorded but never used to influence ordering or inclusion).
 */
export function buildRetrievalContext(
  query: string,
  patientId: string,
  ranked: RankedResult,
  vectorHits: SearchHit[],
  graphExpansionCount: number,
  retrievalTimeMs: number,
  characterBudget: number = DEFAULT_CHARACTER_BUDGET,
): RetrievalContext {
  if (ranked.status === "no_relevant_context") {
    return {
      query,
      patientId,
      status: "no_relevant_context",
      rankedKnowledge: [],
      summaryStatistics: {
        retrievedKnowledgeCount: 0,
        retrievedEvidenceCount: 0,
        truncated: false,
        budgetExceeded: false,
        totalContextSize: 0,
      },
      retrievalMetadata: {
        retrievalTimeMs,
        vectorCandidates: vectorHits.length,
        graphExpansionCount,
        rankingVersion: RANKING_VERSION,
      },
    };
  }

  // Transform every ranked item into its ContextKnowledgeItem shape first
  // (before any budget decisions), so size can be measured accurately.
  const allItems: ContextKnowledgeItem[] = ranked.results.map((item) =>
    toContextItem(item),
  );

  // Whole-item truncation: sorted already descending by hybridScore
  // (guaranteed by M9.4), so greedily include from the front until the
  // budget would be exceeded, then stop. Never split an item.
  const included: ContextKnowledgeItem[] = [];
  let runningSize = 0;
  let truncated = false;

  for (const item of allItems) {
    const itemSize = measureSize(item);
    if (included.length > 0 && runningSize + itemSize > characterBudget) {
      truncated = true;
      break;
    }
    included.push(item);
    runningSize += itemSize;
  }

  const retrievedEvidenceCount = included.reduce(
    (sum, k) => sum + k.evidence.length,
    0,
  );

  return {
    query,
    patientId,
    status: "ok",
    rankedKnowledge: included,
    summaryStatistics: {
      retrievedKnowledgeCount: included.length,
      retrievedEvidenceCount,
      truncated,
      budgetExceeded: runningSize > characterBudget,
      totalContextSize: runningSize,
    },
    retrievalMetadata: {
      retrievalTimeMs,
      vectorCandidates: vectorHits.length,
      graphExpansionCount,
      rankingVersion: RANKING_VERSION,
    },
  };
}

function toContextItem(item: RankedItem): ContextKnowledgeItem {
  // Defensive dedup by evidence.id — M9.2's Cypher already collects
  // DISTINCT evidence, so this should be a no-op in practice, but it's
  // a cheap safety net per the explicit requirement, not a correction
  // of a known bug.
  const seenEvidenceIds = new Set<string>();
  const dedupedEvidence: ContextEvidenceItem[] = [];
  for (const e of item.knowledge.evidence) {
    if (seenEvidenceIds.has(e.id)) continue;
    seenEvidenceIds.add(e.id);
    dedupedEvidence.push({
      id: e.id,
      description: e.description,
      polarity: e.polarity,
      strength: e.strength,
      recency: e.recency,
    });
  }

  return {
    knowledgeId: item.knowledge.knowledgeId,
    claim: item.knowledge.claim,
    confidence: item.knowledge.currentConfidence,
    confidenceTrend: item.knowledge.confidenceTrend,
    hybridScore: item.finalScore,
    sourceSections: item.knowledge.sourceSectionIds,
    evidence: dedupedEvidence,
    provenance: {
      wikiSectionIds: item.knowledge.sourceSectionIds,
      knowledgeId: item.knowledge.knowledgeId,
      evidenceIds: dedupedEvidence.map((e) => e.id),
    },
  };
}

// Character-count proxy for context size — measures the JSON-serialized
// size of exactly what M10 would receive for this item, so the budget
// reflects real payload size rather than an approximation of it.
function measureSize(item: ContextKnowledgeItem): number {
  return JSON.stringify(item).length;
}
