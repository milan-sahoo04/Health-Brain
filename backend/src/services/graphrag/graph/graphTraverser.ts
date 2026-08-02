import { Session } from "neo4j-driver";
import { toNumberSafe } from "../../wiki/neo4jNumberUtil";

export interface RetrievedEvidence {
  id: string;
  evidenceType: string;
  description: string;
  polarity: string;
  strength: number;
  recency: number;
}

export interface RetrievedKnowledge {
  knowledgeId: string;
  claim: string;
  currentConfidence: number;
  confidenceTrend: string;
  involvedMetricNames: [string, string];
  lastEvaluatedAt: string; // NEW — needed for HybridRanker's tie-breaking (M9.4)
  evidence: RetrievedEvidence[];
  sourceSectionIds: string[];
}

/**
 * M9.2: sectionId[] -> RetrievedKnowledge[], via the M9.1 provenance
 * contract (WikiSection -[:SUMMARIZES]-> Knowledge -[:SUPPORTED_BY]-> Evidence).
 * ONE batched round trip (UNWIND), not one query per section — same
 * discipline as M6.4's batched writer and M9.1's batched edge-write.
 *
 * Deduplicates by knowledgeId: if the same Knowledge item is reachable
 * from multiple sections (e.g. it contributes to both majorInsights and
 * confidenceAnalysis), it's returned ONCE, with sourceSectionIds listing
 * every section that surfaced it — callers (HybridRanker, M9.4) need
 * this to correctly attribute vector scores per source section without
 * double-counting the same underlying knowledge.
 *
 * Patient isolation: defensively verifies every returned Knowledge
 * actually belongs to the requesting patientId, even though the current
 * schema (WikiSection.id is patientId-namespaced via computeWikiSectionId)
 * doesn't structurally allow cross-patient leakage today. Cheap check,
 * catches any future schema mistake immediately rather than silently.
 */
export async function expandFromSections(
  session: Session,
  patientId: string,
  sectionIds: string[],
): Promise<RetrievedKnowledge[]> {
  if (sectionIds.length === 0) return [];

  const result = await session.run(
    `
    UNWIND $sectionIds AS sectionId
    MATCH (s:WikiSection {id: sectionId})-[:SUMMARIZES]->(k:Knowledge {currentStatus: "active"})
    OPTIONAL MATCH (k)-[:SUPPORTED_BY]->(e:Evidence)
    WITH sectionId, k, collect(DISTINCT e { .id, .evidenceType, .description, .polarity, .strength, .recency }) AS evidenceList
    MATCH (p:Patient {id: $patientId})-[:HAS_KNOWLEDGE]->(k)
    RETURN sectionId, k { .id, .claim, .currentConfidence, .confidenceTrend, .involvedMetricNames, .lastEvaluatedAt } AS knowledge, evidenceList
    `,
    { patientId, sectionIds },
  );

  // Dedupe by knowledgeId, merging sourceSectionIds across rows.
  const byKnowledgeId = new Map<string, RetrievedKnowledge>();

  for (const record of result.records) {
    const sectionId: string = record.get("sectionId");
    const k = record.get("knowledge");
    const evidenceList = record.get("evidenceList") as any[];

    const knowledgeId: string = k.id;
    const existing = byKnowledgeId.get(knowledgeId);

    if (existing) {
      if (!existing.sourceSectionIds.includes(sectionId)) {
        existing.sourceSectionIds.push(sectionId);
      }
      continue;
    }

    byKnowledgeId.set(knowledgeId, {
      knowledgeId,
      claim: k.claim,
      currentConfidence: k.currentConfidence,
      confidenceTrend: k.confidenceTrend,
      involvedMetricNames: k.involvedMetricNames,
      lastEvaluatedAt: k.lastEvaluatedAt,
      evidence: evidenceList
        .filter((e) => e && e.id)
        .map((e) => ({
          id: e.id,
          evidenceType: e.evidenceType,
          description: e.description,
          polarity: e.polarity,
          strength: e.strength,
          recency: e.recency,
        })),
      sourceSectionIds: [sectionId],
    });
  }

  return Array.from(byKnowledgeId.values());
}
