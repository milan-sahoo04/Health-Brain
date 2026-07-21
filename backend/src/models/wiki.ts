export interface WikiPage {
  id: string; // wiki:<patientId> — ONE per patient
  patientId: string;
  version: number;
  checksum: string; // hash of full rendered content, for change detection
  createdAt: string;
  updatedAt: string;
}

export const WIKI_SECTION_KEYS = [
  "overview",
  "currentConditions",
  "healthTimeline",
  "majorInsights",
  "primaryDrivers",
  "secondaryDrivers",
  "riskAssessment",
  "confidenceAnalysis",
  "supportingEvidence",
] as const;

export type WikiSectionKey = (typeof WIKI_SECTION_KEYS)[number];

export interface WikiSection {
  id: string; // wikisection:<patientId>:<sectionKey>
  wikiPageId: string;
  sectionKey: WikiSectionKey;
  title: string;
  content: string;
  sectionOrder: number;
  checksum: string; // hash of THIS section only — enables incremental regen
  embeddingStatus: "pending" | "embedded" | "stale"; // for M8, not used yet
  createdAt: string;
  updatedAt: string;
}

export interface WikiPageVersion {
  id: string; // wiki-version:<wikiPageId>:<versionNumber>
  wikiPageId: string;
  versionNumber: number;
  checksum: string;
  changedSections: WikiSectionKey[]; // which sections changed in this version — audit trail
  createdAt: string;
}
