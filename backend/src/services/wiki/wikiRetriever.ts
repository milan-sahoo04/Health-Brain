import { Session } from "neo4j-driver";

export interface KnowledgeForWikiPreview {
  claim: string;
  currentConfidence: number;
  currentStatus: string;
  sourceType: string;
  involvedMetricNames: [string, string];
}

/**
 * M7.1 scope: ONE query, reads active Knowledge for a patient. This is
 * the seed of the composed retrieval layer M7.2 will expand — kept
 * minimal here since M7.1 is only about proving the id scheme and
 * confirming real data can be found, not building the full retriever.
 */
export async function previewKnowledgeForWiki(
  session: Session,
  patientId: string,
): Promise<KnowledgeForWikiPreview[]> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "active"})
    RETURN k.claim AS claim, k.currentConfidence AS currentConfidence, k.currentStatus AS currentStatus,
           k.sourceType AS sourceType, k.involvedMetricNames AS involvedMetricNames
    ORDER BY k.currentConfidence DESC
    `,
    { patientId },
  );
  return result.records.map((r) => ({
    claim: r.get("claim"),
    currentConfidence: r.get("currentConfidence"),
    currentStatus: r.get("currentStatus"),
    sourceType: r.get("sourceType"),
    involvedMetricNames: r.get("involvedMetricNames"),
  }));
}

// --- add to existing file ---
export interface WikiEvidenceItem {
  id: string;
  evidenceType: string;
  description: string;
  polarity: string;
  weight: number;
  strength: number;
  recency: number;
  frequency: number;
  consistency: number;
  createdAt: string;
}

export interface WikiKnowledgeItem {
  knowledgeId: string;
  claim: string;
  currentConfidence: number;
  currentStatus: string;
  sourceType: string;
  involvedMetricNames: [string, string];
  firstPromotedAt: string;
  lastEvaluatedAt: string;
  versionCount: number;
  confidenceTrend: string;
  evidence: WikiEvidenceItem[];
  sourceLabels: string[]; // provenance: labels of the original Pattern/PatternCandidate
  originatingHypothesisId: string | null;
}

export interface WikiRetrievalResult {
  patientId: string;
  knowledgeItems: WikiKnowledgeItem[];
}

/**
 * M7.2: THE composed retrieval query — ONE Neo4j round trip per patient,
 * per Decision 3. Pulls Knowledge, its Evidence, AND its provenance
 * chain (Knowledge -> PROMOTED_FROM -> KnowledgeCandidate -> DERIVED_FROM
 * -> original Pattern/PatternCandidate) in a single session.run() call.
 *
 * Evidence is aggregated via an intermediate WITH BEFORE the provenance
 * MATCH is added — this collapses evidence into a list per Knowledge
 * node first, preventing the classic Cypher combinatorial-blowup bug
 * where joining two one-to-many relationships in sequence without an
 * intermediate aggregation multiplies rows (e.g. 3 evidence items x 2
 * provenance matches = 6 duplicated rows instead of 1 correct one).
 */
export async function retrieveWikiData(
  session: Session,
  patientId: string,
): Promise<WikiRetrievalResult> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    OPTIONAL MATCH (p)-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "active"})
    WITH p, k
    OPTIONAL MATCH (k)-[:SUPPORTED_BY]->(e:Evidence)
    WITH p, k, collect(DISTINCT e { .id, .evidenceType, .description, .polarity, .weight, .strength, .recency, .frequency, .consistency, .createdAt }) AS evidenceList
    OPTIONAL MATCH (k)-[:PROMOTED_FROM]->(kc:KnowledgeCandidate)-[:DERIVED_FROM]->(source)
    WITH p, k, evidenceList, kc, labels(source) AS sourceLabels
    RETURN p.id AS patientId, collect(
      CASE WHEN k IS NULL THEN null ELSE {
        knowledgeId: k.id, claim: k.claim, currentConfidence: k.currentConfidence,
        currentStatus: k.currentStatus, sourceType: k.sourceType,
        involvedMetricNames: k.involvedMetricNames, firstPromotedAt: k.firstPromotedAt,
        lastEvaluatedAt: k.lastEvaluatedAt, versionCount: k.versionCount,
        confidenceTrend: k.confidenceTrend, evidence: evidenceList,
        sourceLabels: sourceLabels, originatingHypothesisId: kc.hypothesisId
      } END
    ) AS knowledgeItems
    `,
    { patientId },
  );

  if (result.records.length === 0) {
    return { patientId, knowledgeItems: [] };
  }

  const raw = result.records[0].get(
    "knowledgeItems",
  ) as (WikiKnowledgeItem | null)[];
  // Filters the [null] placeholder that OPTIONAL MATCH produces for
  // patients with zero active Knowledge — collect() over an all-null
  // OPTIONAL MATCH still returns one row containing null, not [].
  const knowledgeItems = raw.filter(
    (item): item is WikiKnowledgeItem => item !== null,
  );

  return { patientId: result.records[0].get("patientId"), knowledgeItems };
}
