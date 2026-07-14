import { Session } from "neo4j-driver";
import { CorrelationResult } from "./correlationEngine";
import { AssociationRule } from "./associationRuleMiner";

const MIN_CONFIDENCE_TO_STORE = 0.2; // below this: still stored, but marked "too_weak"
const ACTIVE_THRESHOLD = 0.5; // matches your architecture doc's "passes threshold" concept

const MIN_LIFT_TO_STORE = 1.5; // below this: still stored, but marked "too_weak"
const ACTIVE_LIFT_THRESHOLD = 5; // separates routine co-logging from genuine clinical clusters

export type PatternStatus = "active" | "below_threshold" | "too_weak";

export interface PersistedPatternSummary {
  metricA: string;
  metricB: string;
  status: PatternStatus;
  confidence: number;
  stored: boolean;
}

export interface PersistedAssociationSummary {
  itemA: string;
  itemB: string;
  status: PatternStatus;
  lift: number;
  stored: boolean;
}

function correlationStatus(confidence: number): PatternStatus {
  if (confidence >= ACTIVE_THRESHOLD) return "active";
  if (confidence >= MIN_CONFIDENCE_TO_STORE) return "below_threshold";
  return "too_weak";
}

function associationStatus(lift: number): PatternStatus {
  if (lift >= ACTIVE_LIFT_THRESHOLD) return "active";
  if (lift >= MIN_LIFT_TO_STORE) return "below_threshold";
  return "too_weak";
}

/**
 * Writes one correlation result as an upserted (:Pattern) node.
 *
 * Always writes, regardless of score — a pattern that weakens over time must
 * have its status/lastUpdated refreshed, not go stale. The three-tier status
 * (active / below_threshold / too_weak) records the full history of every
 * metric pair ever evaluated, which the Closed-Loop Learning design (Section 8
 * of the architecture doc) depends on. Nothing is ever deleted here.
 *
 * Upsert key = (patientId, metricA, metricB, method) with metric names sorted
 * alphabetically first, so "A vs B" and "B vs A" always resolve to the same
 * node instead of creating duplicates.
 */
export async function persistPattern(
  session: Session,
  patientId: string,
  result: CorrelationResult,
): Promise<PersistedPatternSummary> {
  const status = correlationStatus(result.confidence);

  // Sort so the pair key is order-independent
  const [sortedA, sortedB] = [result.metricA, result.metricB].sort();

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_PATTERN]->(pattern:Pattern {
      patientId: $patientId,
      metricA: $sortedA,
      metricB: $sortedB,
      method: "correlation"
    })
    SET
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
 * method: "association". Always writes, same rationale as persistPattern
 * above — a rule's status must stay current, never frozen from a past run.
 * Upsert key = (patientId, itemA, itemB, method) with items sorted
 * alphabetically, same order-independence approach as correlation.
 */
export async function persistAssociationRule(
  session: Session,
  patientId: string,
  rule: AssociationRule,
): Promise<PersistedAssociationSummary> {
  const status = associationStatus(rule.lift);
  const [sortedA, sortedB] = [rule.itemA, rule.itemB].sort();

  await session.run(
    `
    MATCH (p:Patient {id: $patientId})
    MERGE (p)-[:HAS_PATTERN]->(pattern:Pattern {
      patientId: $patientId,
      metricA: $sortedA,
      metricB: $sortedB,
      method: "association"
    })
    SET
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
