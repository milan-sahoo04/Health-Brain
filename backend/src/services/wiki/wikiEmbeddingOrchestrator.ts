import { Session } from "neo4j-driver";
import { WikiGenerationResult } from "./wikiGenerator";
import { embedSection } from "./wikiEmbeddingClient";
import { computeWikiSectionId } from "../../models/wikiMetadata";

export interface EmbeddingSyncResult {
  patientId: string;
  attempted: number;
  embedded: number;
  skipped: number;
  failed: number;
  skippedNoKnowledge: boolean;
}

/**
 * M8.4: called AFTER generateWiki() succeeds. Embeds ONLY the sections
 * generateWiki reported as changed — never a full re-scan. Per the
 * approved skip rule, does nothing at all if the patient has zero
 * active Knowledge (checked here, since the vector service has no
 * Neo4j access to check this itself).
 *
 * Failure isolation: a failed /embed call for one section marks that
 * section "stale" and continues to the next — never throws, never
 * rolls back the wiki write that already succeeded.
 */
export async function syncEmbeddings(
  session: Session,
  patientId: string,
  wikiResult: WikiGenerationResult,
): Promise<EmbeddingSyncResult> {
  if (wikiResult.changedSections.length === 0) {
    return {
      patientId,
      attempted: 0,
      embedded: 0,
      skipped: 0,
      failed: 0,
      skippedNoKnowledge: false,
    };
  }

  const knowledgeCountResult = await session.run(
    `MATCH (p:Patient {id: $patientId})-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "active"}) RETURN count(k) AS c`,
    { patientId },
  );
  const activeKnowledgeCount = knowledgeCountResult.records[0]
    .get("c")
    .toNumber();

  if (activeKnowledgeCount === 0) {
    // Per the approved placeholder-skip rule: don't embed empty sections.
    return {
      patientId,
      attempted: 0,
      embedded: 0,
      skipped: 0,
      failed: 0,
      skippedNoKnowledge: true,
    };
  }

  let embedded = 0,
    skipped = 0,
    failed = 0;

  for (const sectionKey of wikiResult.changedSections) {
    const sectionId = computeWikiSectionId(patientId, sectionKey as any);

    const sectionResult = await session.run(
      `MATCH (s:WikiSection {id: $sectionId}) RETURN s.content AS content, s.checksum AS checksum, s.title AS title`,
      { sectionId },
    );
    if (sectionResult.records.length === 0) continue;
    const content: string = sectionResult.records[0].get("content");
    const checksum: string = sectionResult.records[0].get("checksum");
    const title: string = sectionResult.records[0].get("title");
    try {
      const result = await embedSection(
        sectionId,
        content,
        checksum,
        patientId,
        sectionKey,
        title,
      );
      if (result.status === "embedded") embedded++;
      else skipped++;

      await session.run(
        `MATCH (s:WikiSection {id: $sectionId}) SET s.embeddingStatus = "embedded", s.vectorId = $vectorId, s.embeddingVersion = $embeddingVersion`,
        {
          sectionId,
          vectorId: result.vectorId ?? sectionId,
          embeddingVersion: result.embeddingVersion ?? null,
        },
      );
    } catch (err) {
      console.error(
        `Embedding failed for section ${sectionId}:`,
        err instanceof Error ? err.message : err,
      );
      failed++;
      // Leave/mark as "stale" — per the lifecycle, a failed embed must
      // never report "embedded" falsely.
      await session.run(
        `MATCH (s:WikiSection {id: $sectionId}) SET s.embeddingStatus = "stale"`,
        { sectionId },
      );
    }
  }

  return {
    patientId,
    attempted: wikiResult.changedSections.length,
    embedded,
    skipped,
    failed,
    skippedNoKnowledge: false,
  };
}
