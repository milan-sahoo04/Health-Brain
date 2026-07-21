import { Session } from "neo4j-driver";
import { retrieveWikiData } from "./wikiRetriever";
import { buildAllSections, BuiltSection } from "./sectionBuilders";
import { computeChecksum } from "./checksumUtil";
import {
  computeWikiPageId,
  computeWikiSectionId,
  computeWikiVersionId,
} from "../../models/wikiMetadata";
import { toNumberSafe } from "./neo4jNumberUtil";

export interface WikiGenerationResult {
  patientId: string;
  wikiPageId: string;
  action: "created" | "updated" | "unchanged";
  versionNumber: number;
  changedSections: string[];
}

/**
 * M7.4: the full generate-or-update pipeline for one patient's wiki.
 * Reads current section checksums (if the page exists), builds fresh
 * sections from live Knowledge, diffs checksums, and writes ONLY what
 * changed — in one batched transaction, same UNWIND...IN TRANSACTIONS
 * pattern already validated at scale in M6.4.
 */
export async function generateWiki(
  session: Session,
  patientId: string,
): Promise<WikiGenerationResult> {
  const wikiPageId = computeWikiPageId(patientId);
  const now = new Date().toISOString();

  // Step 1: read existing section checksums (empty map if page doesn't exist yet)
  const existingResult = await session.run(
    `
    MATCH (w:WikiPage {id: $wikiPageId})
    OPTIONAL MATCH (w)-[:HAS_SECTION]->(s:WikiSection)
    RETURN w.version AS pageVersion, collect({sectionKey: s.sectionKey, checksum: s.checksum}) AS sections
    `,
    { wikiPageId },
  );
  const pageExists = existingResult.records.length > 0;
  const currentPageVersion = pageExists
    ? toNumberSafe(existingResult.records[0].get("pageVersion"))
    : 0;
  const existingChecksums = new Map<string, string>();
  if (pageExists) {
    for (const s of existingResult.records[0].get("sections")) {
      if (s.sectionKey) existingChecksums.set(s.sectionKey, s.checksum);
    }
  }

  // Step 2: build fresh sections from live data
  const data = await retrieveWikiData(session, patientId);
  const freshSections: (BuiltSection & { checksum: string; id: string })[] =
    buildAllSections(data).map((s) => ({
      ...s,
      checksum: computeChecksum(s.content),
      id: computeWikiSectionId(patientId, s.sectionKey),
    }));

  // Step 3: diff — only sections whose checksum actually changed
  const changedSections = freshSections.filter(
    (s) => existingChecksums.get(s.sectionKey) !== s.checksum,
  );

  if (pageExists && changedSections.length === 0) {
    return {
      patientId,
      wikiPageId,
      action: "unchanged",
      versionNumber: currentPageVersion,
      changedSections: [],
    };
  }

  const nextPageVersion = currentPageVersion + 1;
  const pageChecksum = computeChecksum(
    freshSections.map((s) => s.checksum).join("|"),
  );

  // Step 4: single transaction — create/update Patient link + WikiPage,
  // batched UNWIND over only the CHANGED sections (not all 9 every time).
  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_WIKI]->(w:WikiPage {id: $wikiPageId})
    SET w.patientId = $patientId, w.version = $nextPageVersion, w.checksum = $pageChecksum,
        w.updatedAt = $now, w.createdAt = coalesce(w.createdAt, $now)
    WITH w, p
    OPTIONAL MATCH (p)-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "active"})
    FOREACH (_ IN CASE WHEN k IS NOT NULL THEN [1] ELSE [] END | MERGE (w)-[:SUMMARIZES]->(k))
    WITH w
    UNWIND $changedSections AS sec
    MERGE (w)-[:HAS_SECTION]->(s:WikiSection {id: sec.id})
    SET s.wikiPageId = $wikiPageId, s.sectionKey = sec.sectionKey, s.title = sec.title,
        s.content = sec.content, s.sectionOrder = sec.sectionOrder, s.checksum = sec.checksum,
        s.embeddingStatus = "pending", s.updatedAt = $now, s.createdAt = coalesce(s.createdAt, $now)
    WITH w, collect(sec.sectionKey) AS changedKeys
    CREATE (v:WikiPageVersion {
      id: $wikiVersionId, wikiPageId: $wikiPageId, versionNumber: $nextPageVersion,
      checksum: $pageChecksum, changedSections: changedKeys, createdAt: $now
    })
    CREATE (w)-[:HAS_VERSION]->(v)
    `,
    {
      patientId,
      wikiPageId,
      nextPageVersion,
      pageChecksum,
      now,
      wikiVersionId: computeWikiVersionId(wikiPageId, nextPageVersion),
      changedSections: changedSections.map((s, i) => ({
        ...s,
        sectionOrder: freshSections.indexOf(s),
      })),
    },
  );

  return {
    patientId,
    wikiPageId,
    action: pageExists ? "updated" : "created",
    versionNumber: nextPageVersion,
    changedSections: changedSections.map((s) => s.sectionKey),
  };
}
