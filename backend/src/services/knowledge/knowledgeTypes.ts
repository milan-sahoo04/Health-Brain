/**
 * Durable, permanent memory node — never deleted, only ever appended-to
 * via KnowledgeVersion (see Step 5 of the M6 architecture review). This
 * is the shape that will eventually be MERGE'd in M6.2 — defined now so
 * the deterministic id logic below has a concrete target shape to test
 * against.
 */
export interface Knowledge {
  id: string; // knowledge:<patientId>:<hypothesisId>
  patientId: string;
  claim: string;
  currentConfidence: number;
  currentStatus: "active" | "retracted";
  sourceType: string; // carried from Hypothesis.sourceType
  involvedMetricNames: [string, string];
  firstPromotedAt: string;
  lastEvaluatedAt: string;
  versionCount: number;
  retractedAt: string | null; // NEW
  retractionReason: string | null; // NEW
}

/**
 * Append-only history entry. Every promotion run that finds a MATERIAL
 * confidence change (defined in M6.3) appends one of these rather than
 * overwriting the parent Knowledge node's fields.
 */
export interface KnowledgeVersion {
  id: string; // knowledge-version:<knowledgeId>:<versionNumber>
  knowledgeId: string;
  versionNumber: number;
  confidence: number;
  confidenceBreakdownJson: string; // same JSON-string convention as KnowledgeCandidate (M5.4)
  reasoningSteps: string[];
  contradictionReportJson: string;
  knowledgeCandidateId: string; // which specific KnowledgeCandidate run produced this version
  createdAt: string;
  retractionReason: string | null;
}

/**
 * Computes the deterministic Knowledge id for a given
 * (patientId, hypothesisId) pair. Pure function, no I/O — testable in
 * isolation, and guarantees re-running the full pipeline from scratch
 * reconstructs the SAME Knowledge id every time, since hypothesisId
 * itself is already deterministic (M5.1).
 */
export function computeKnowledgeId(
  patientId: string,
  hypothesisId: string,
): string {
  return `knowledge:${patientId}:${hypothesisId}`;
}

/**
 * Computes the deterministic KnowledgeVersion id for a given Knowledge id
 * and version number. versionNumber is supplied by the caller (M6.3 will
 * determine it by counting existing versions) — this function only
 * formats the id consistently.
 */
export function computeKnowledgeVersionId(
  knowledgeId: string,
  versionNumber: number,
): string {
  return `knowledge-version:${knowledgeId}:${versionNumber}`;
}
