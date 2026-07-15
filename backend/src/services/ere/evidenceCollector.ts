import { Session } from "neo4j-driver";
import { Hypothesis } from "./hypothesisFactory";
import { Evidence } from "./evidence";
import { buildPatientMetricSeries } from "../timeSeriesBuilder";
import { buildEventTimeline } from "../eventTimeline";
import {
  correlateMetricPair,
  CorrelationResult,
  AlignedObservation,
} from "../correlationEngine";

const RECENCY_DAYS_HALF_LIFE = 90; // matches correlationEngine.ts's own recency window

function recencyScore(dateStr: string): number {
  const daysAgo = Math.max(
    0,
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(0.3, 1 - daysAgo / RECENCY_DAYS_HALF_LIFE); // same floor as correlationEngine's recency factor
}

function observationToEvidence(
  obs: AlignedObservation,
  patientId: string,
  result: CorrelationResult,
  index: number,
): Evidence {
  const polarity = obs.confounded ? "contradicting" : "supporting";
  return {
    id: `evi:temporal:${patientId}:${result.metricA}:${result.metricB}:${index}`,
    patientId,
    evidenceType: obs.confounded ? "confounder" : "temporal_alignment",
    description: obs.confounded
      ? `${result.metricA} vs ${result.metricB} observation on ${obs.dateA} is confounded by ${obs.confoundedBy}`
      : `${result.metricA} (${obs.valueA}) and ${result.metricB} (${obs.valueB}) aligned within tolerance on ${obs.dateA}/${obs.dateB}`,
    sourceEventIds: [], // raw event node ids aren't tracked at this granularity yet — dates are the join key today
    sourceNodeIds: [],
    sourceRelationshipIds: [],
    polarity,
    weight: polarity === "supporting" ? 1 : 1, // weighting refined in M5.3, kept neutral here
    strength: Math.min(1, result.confidence),
    recency: recencyScore(obs.dateA),
    frequency: Math.min(1, result.evidenceCount / 10), // same normalization convention as correlationEngine
    consistency: 1, // per-observation consistency isn't meaningful; aggregate consistency lives in the CorrelationResult itself
    confidenceContribution: 0, // populated in M5.3
    createdAt: new Date().toISOString(),
  };
}

/**
 * For gnn_candidate hypotheses, adds ONE structural evidence item derived
 * from the original PatternCandidate's supportingNodes/supportingEdges —
 * this is the graph-structural signal M4 already computed, surfaced here
 * as Evidence rather than recomputed.
 */
async function collectGraphStructuralEvidence(
  session: Session,
  hypothesis: Hypothesis,
): Promise<Evidence[]> {
  if (hypothesis.sourceType !== "gnn_candidate") return [];

  const result = await session.run(
    `
    MATCH (c:PatternCandidate) WHERE elementId(c) = $id
    RETURN c.supportingNodes AS supportingNodes, c.supportingEdges AS supportingEdges, c.confidence AS confidence
    `,
    { id: hypothesis.sourceNodeId },
  );
  if (result.records.length === 0) return [];

  const record = result.records[0];
  const supportingNodes: string[] = record.get("supportingNodes") ?? [];
  const confidence: number = record.get("confidence") ?? 0;

  return [
    {
      id: `evi:structural:${hypothesis.id}`,
      patientId: hypothesis.patientId,
      evidenceType: "graph_structural",
      description: `GNN model's ${supportingNodes.length}-node local neighborhood supports this structural association (model confidence ${confidence.toFixed(2)})`,
      sourceEventIds: [],
      sourceNodeIds: supportingNodes,
      sourceRelationshipIds: [],
      polarity: "supporting",
      weight: 1,
      strength: confidence,
      recency: 1, // graph structure has no independent date — treated as always-current
      frequency: 1,
      consistency: 1,
      confidenceContribution: 0,
      createdAt: new Date().toISOString(),
    },
  ];
}

/**
 * Collects all evidence for one Hypothesis, regardless of its source —
 * because every Hypothesis already resolves to involvedMetricNames
 * (M5.1's unification), evidence collection is IDENTICAL for
 * legacy_correlation, legacy_association, and gnn_candidate hypotheses.
 * Only gnn_candidate gets the additional graph_structural item.
 *
 * Returns [] (never throws) when there isn't enough numeric data to
 * evaluate — the caller treats empty evidence as "inconclusive", per
 * Section 4's missing-evidence handling. Absence of evidence must never
 * be silently treated as contradicting evidence.
 */
export async function collectEvidenceForHypothesis(
  session: Session,
  hypothesis: Hypothesis,
): Promise<Evidence[]> {
  const [metricA, metricB] = hypothesis.involvedMetricNames;

  const seriesMap = await buildPatientMetricSeries(
    session,
    hypothesis.patientId,
  );
  const timeline = await buildEventTimeline(session, hypothesis.patientId);

  const seriesA = seriesMap.get(metricA);
  const seriesB = seriesMap.get(metricB);

  const graphEvidence = await collectGraphStructuralEvidence(
    session,
    hypothesis,
  );

  if (!seriesA || !seriesB) {
    // No numeric series for one or both metrics (e.g. a purely categorical
    // association-rule hypothesis) — safe, honest empty result.
    return graphEvidence;
  }

  const typeA = metricA.split(":")[0];
  const typeB = metricB.split(":")[0];

  const result = correlateMetricPair(seriesA, seriesB, timeline, typeA, typeB);
  if (!result) return graphEvidence; // not enough clean observations — inconclusive, not rejected

  const temporalEvidence = result.observations.map((obs, i) =>
    observationToEvidence(obs, hypothesis.patientId, result, i),
  );

  return [...temporalEvidence, ...graphEvidence];
}
