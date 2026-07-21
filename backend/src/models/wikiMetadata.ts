import { WikiSectionKey } from "./wiki";

export function computeWikiPageId(patientId: string): string {
  return `wiki:${patientId}`;
}

export function computeWikiSectionId(
  patientId: string,
  sectionKey: WikiSectionKey,
): string {
  return `wikisection:${patientId}:${sectionKey}`;
}

export function computeWikiVersionId(
  wikiPageId: string,
  versionNumber: number,
): string {
  return `wiki-version:${wikiPageId}:${versionNumber}`;
}
