import { Session, Integer } from "neo4j-driver";

/**
 * Extensible source-type union. Adding a future third hypothesis source
 * (e.g. a causal-inference module) means adding one string here, not
 * changing every consumer of Hypothesis.
 */
export type HypothesisSourceType =
  | "legacy_correlation"
  | "legacy_association"
  | "gnn_candidate";

export type HypothesisDirection = "direct" | "inverse" | "unknown";

export type HypothesisStatus =
  | "generated"
  | "evaluated"
  | "accepted"
  | "rejected"
  | "inconclusive";

/**
 * Unified internal model — BOTH :Pattern and :PatternCandidate converge
 * here. Everything downstream (EvidenceCollector, ConfidenceScorer, etc.)
 * operates on THIS shape only and never needs to know which Neo4j label
 * a hypothesis originally came from, except via sourceType for
 * source-reliability weighting (Section 6 of the architecture review).
 */
export interface Hypothesis {
  id: string; // deterministic, derived from source node id — stable across re-runs
  schemaVersion: number; // extensibility hook — bump when the shape changes, don't break old data
  patientId: string;
  sourceType: HypothesisSourceType;
  sourceNodeId: string; // elementId of the originating :Pattern or :PatternCandidate node
  claim: string; // human-readable, e.g. "Walking is associated with HbA1c"
  direction: HypothesisDirection;
  priorConfidence: number; // the SOURCE's own confidence/lift — never used as final confidence
  involvedMetricNames: [string, string]; // resolved where possible; GNN source resolves via node.type lookup
  involvedNodeIds: [string, string] | null; // resolved for GNN source directly; null for legacy until/unless resolved
  status: HypothesisStatus;
  fusionKey: string | null; // reserved for future Hypothesis Fusion — always null in M5.1
  createdAt: string;
}

/**
 * Converts one :Pattern node's properties into a Hypothesis.
 * Handles BOTH method="correlation" and method="association" shapes,
 * since patternPersistence.ts writes both under the same label.
 */
function hypothesisFromPattern(
  patientId: string,
  patternNode: any,
): Hypothesis {
  const props = patternNode.properties;
  const nodeId: string =
    patternNode.elementId ?? patternNode.identity.toString();
  const isAssociation = props.method === "association";

  const confidence = isAssociation ? props.lift : props.confidence;
  const direction: HypothesisDirection =
    !isAssociation &&
    (props.direction === "direct" || props.direction === "inverse")
      ? props.direction
      : "unknown"; // association rules carry a string direction like "A -> B", not direct/inverse

  return {
    id: `hyp:pattern:${nodeId}`,
    schemaVersion: 1,
    patientId,
    sourceType: isAssociation ? "legacy_association" : "legacy_correlation",
    sourceNodeId: nodeId,
    claim: `${props.metricA} is ${isAssociation ? "associated with" : "correlated with"} ${props.metricB}`,
    direction,
    priorConfidence: typeof confidence === "number" ? confidence : 0,
    involvedMetricNames: [props.metricA, props.metricB],
    involvedNodeIds: null, // legacy Pattern nodes reference metric names, not specific event node ids
    status: "generated",
    fusionKey: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Converts one :PatternCandidate node's properties into a Hypothesis.
 * GNN candidates DO carry real event node ids (sourceNodeId/targetNodeId
 * on the candidate itself), so involvedNodeIds is populated here, unlike
 * the legacy path.
 */
function hypothesisFromCandidate(
  patientId: string,
  candidateNode: any,
  metricNamesByNodeId: Map<string, string>,
): Hypothesis {
  const props = candidateNode.properties;
  const nodeId: string =
    candidateNode.elementId ?? candidateNode.identity.toString();

  const srcMetric =
    metricNamesByNodeId.get(props.sourceNodeId) ?? "UnknownMetric";
  const tgtMetric =
    metricNamesByNodeId.get(props.targetNodeId) ?? "UnknownMetric";

  return {
    id: `hyp:candidate:${nodeId}`,
    schemaVersion: 1,
    patientId,
    sourceType: "gnn_candidate",
    sourceNodeId: nodeId,
    claim: `${srcMetric} is structurally associated with ${tgtMetric} (GNN)`,
    direction: "unknown", // see M4 design note (a) — GNN link predictor has no direction signal
    priorConfidence:
      typeof props.confidence === "number" ? props.confidence : 0,
    involvedMetricNames: [srcMetric, tgtMetric],
    involvedNodeIds: [props.sourceNodeId, props.targetNodeId],
    status: "generated",
    fusionKey: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Resolves event node ids -> their metric type, for labeling GNN
 * candidates with human-readable claims instead of raw node ids.
 * O(1) per lookup after one batched query — same complexity discipline
 * as the rest of the codebase.
 */
async function buildNodeIdToMetricMap(
  session: Session,
  patientId: string,
): Promise<Map<string, string>> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
    RETURN elementId(e) AS nodeId, e.type AS type
    `,
    { patientId },
  );
  const map = new Map<string, string>();
  for (const record of result.records) {
    map.set(
      record.get("nodeId") as string,
      (record.get("type") as string) ?? "Unknown",
    );
  }
  return map;
}

/**
 * Main entrypoint for M5.1 — pulls every evaluable :Pattern and
 * :PatternCandidate for one patient and returns them as unified
 * Hypothesis objects.
 *
 * Excludes :Pattern nodes with status "too_weak" (not worth reasoning
 * about) but includes "active" AND "below_threshold" for BOTH sources —
 * M5's whole purpose is to independently re-evaluate confidence via real
 * evidence, so a below_threshold statistical/structural score is exactly
 * the kind of borderline case ERE should weigh in on, not skip.
 */
export async function buildHypothesesForPatient(
  session: Session,
  patientId: string,
): Promise<Hypothesis[]> {
  const patternResult = await session.run(
    `
   MATCH (p:Patient {id: $patientId})-[:HAS_PATTERN]->(pattern:Pattern)
   WHERE pattern.status IN ["active", "below_threshold"]
   RETURN pattern
   `,
    { patientId },
  );
  const candidateResult = await session.run(
    `
   MATCH (p:Patient {id: $patientId})-[:HAS_CANDIDATE]->(candidate:PatternCandidate)
   WHERE candidate.status IN ["active", "below_threshold"]
   RETURN candidate
   `,
    { patientId },
  );
  const metricMap = await buildNodeIdToMetricMap(session, patientId);

  const patternHypotheses = patternResult.records.map((r) =>
    hypothesisFromPattern(patientId, r.get("pattern")),
  );
  const candidateHypotheses = candidateResult.records.map((r) =>
    hypothesisFromCandidate(patientId, r.get("candidate"), metricMap),
  );

  return [...patternHypotheses, ...candidateHypotheses];
}
