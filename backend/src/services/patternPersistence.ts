import { Session } from "neo4j-driver";
import { CorrelationResult } from "./correlationEngine";
import { AssociationRule } from "./associationRuleMiner";

const MIN_CONFIDENCE_TO_STORE = 0.2; // below this, too weak to bother persisting at all
const ACTIVE_THRESHOLD = 0.5; // matches your architecture doc's "passes threshold" concept

const MIN_LIFT_TO_STORE = 1.5; // below this, association is too weak to be meaningful
const ACTIVE_LIFT_THRESHOLD = 5; // separates routine co-logging from genuine clinical clusters

export interface PersistedPatternSummary {
  metricA: string;
  metricB: string;
  status: "active" | "below_threshold";
  confidence: number;
  stored: boolean;
}

export interface PersistedAssociationSummary {
  itemA: string;
  itemB: string;
  status: "active" | "below_threshold";
  lift: number;
  stored: boolean;
}
/**
 * Writes one correlation result as an upserted (:Pattern) node.
 *
 * Upsert key = (patientId, metricA, metricB) with metric names sorted
 * alphabetically first, so "A vs B" and "B vs A" always resolve to the same
 * node instead of creating duplicates. Re-running this for the same pair
 * always updates the existing node — required for idempotent nightly runs
 * (Section 3.3 of the production architecture doc).
 */
export async function persistPattern(
  session: Session,
  patientId: string,
  result: CorrelationResult,
): Promise<PersistedPatternSummary> {
  if (result.confidence < MIN_CONFIDENCE_TO_STORE) {
    return {
      metricA: result.metricA,
      metricB: result.metricB,
      status: "below_threshold",
      confidence: result.confidence,
      stored: false,
    };
  }

  const status =
    result.confidence >= ACTIVE_THRESHOLD ? "active" : "below_threshold";

  // Sort so the pair key is order-independent
  const [sortedA, sortedB] = [result.metricA, result.metricB].sort();

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_PATTERN]->(pattern:Pattern {
      patientId: $patientId,
      metricA: $sortedA,
      metricB: $sortedB
    })
    SET
      pattern.method = "correlation",
      pattern.direction = $direction,
      pattern.lagDays = $lagDays,
      pattern.confidence = $confidence,
      pattern.evidenceCount = $evidenceCount,
      pattern.excludedConfounded = $excludedConfounded,
      pattern.status = $status,
      pattern.lastUpdated = $now,
      pattern.createdAt = coalesce(pattern.createdAt, $now)
    `,
    {
      patientId,
      sortedA,
      sortedB,
      direction: result.direction,
      lagDays: result.lagDays,
      confidence: result.confidence,
      evidenceCount: result.evidenceCount,
      excludedConfounded: result.excludedConfounded,
      status,
      now: new Date().toISOString(),
    },
  );

  return {
    metricA: result.metricA,
    metricB: result.metricB,
    status,
    confidence: result.confidence,
    stored: true,
  };
}

/**
 * Persists an entire batch of correlation results for one patient in one call.
 */
export async function persistAllPatterns(
  session: Session,
  patientId: string,
  results: CorrelationResult[],
): Promise<PersistedPatternSummary[]> {
  const summaries: PersistedPatternSummary[] = [];
  for (const result of results) {
    summaries.push(await persistPattern(session, patientId, result));
  }
  return summaries;
}

/**
 * Writes one association rule as an upserted (:Pattern) node — same table,
 * same Patient relationship as correlation Patterns, distinguished by
 * method: "association". Upsert key = (patientId, itemA, itemB) with items
 * sorted alphabetically, same order-independence approach as correlation.
 */
export async function persistAssociationRule(
  session: Session,
  patientId: string,
  rule: AssociationRule,
): Promise<PersistedAssociationSummary> {
  if (rule.lift < MIN_LIFT_TO_STORE) {
    return {
      itemA: rule.itemA,
      itemB: rule.itemB,
      status: "below_threshold",
      lift: rule.lift,
      stored: false,
    };
  }

  const status =
    rule.lift >= ACTIVE_LIFT_THRESHOLD ? "active" : "below_threshold";
  const [sortedA, sortedB] = [rule.itemA, rule.itemB].sort();

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_PATTERN]->(pattern:Pattern {
      patientId: $patientId,
      metricA: $sortedA,
      metricB: $sortedB
    })
    SET
      pattern.method = "association",
      pattern.direction = $direction,
      pattern.support = $support,
      pattern.confidence = $confidence,
      pattern.lift = $lift,
      pattern.occurrenceCount = $occurrenceCount,
      pattern.status = $status,
      pattern.lastUpdated = $now,
      pattern.createdAt = coalesce(pattern.createdAt, $now)
    `,
    {
      patientId,
      sortedA,
      sortedB,
      direction: rule.direction,
      support: rule.support,
      confidence: rule.confidence,
      lift: rule.lift,
      occurrenceCount: rule.occurrenceCount,
      status,
      now: new Date().toISOString(),
    },
  );

  return {
    itemA: rule.itemA,
    itemB: rule.itemB,
    status,
    lift: rule.lift,
    stored: true,
  };
}

export async function persistAllAssociationRules(
  session: Session,
  patientId: string,
  rules: AssociationRule[],
): Promise<PersistedAssociationSummary[]> {
  const summaries: PersistedAssociationSummary[] = [];
  for (const rule of rules) {
    summaries.push(await persistAssociationRule(session, patientId, rule));
  }
  return summaries;
}
