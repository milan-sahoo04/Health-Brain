import { withSession } from "../neo4j";

export type PatternMethod = "correlation" | "association";
export type PatternStatus = "active" | "below_threshold";

export interface PatternDateRef {
  date: string;
  type: string;
  fieldKey: string;
  confoundedBy?: string;
}

export interface PatternRecord {
  patientId: string;
  method: PatternMethod;
  metricA: string;
  metricB: string;
  lagDays: number | null;
  direction: "direct" | "inverse" | null;
  strength: number;
  confidence: number;
  evidenceCount: number;
  excludedConfounded: number;
  status: PatternStatus;
  supportedDates: PatternDateRef[];
  confoundedDates: PatternDateRef[];
}

function buildPatternId(
  p: Pick<
    PatternRecord,
    "patientId" | "method" | "metricA" | "metricB" | "lagDays"
  >,
): string {
  return [p.patientId, p.method, p.metricA, p.metricB, p.lagDays ?? "na"].join(
    ":",
  );
}

// Splits a metric name like "Lab:HbA1c" or "Medication:Metformin:adherencePercent"
// into the event `type` (first segment) and the actual field key on that event
// (last segment) — good enough to locate the underlying Event node.
function parseMetricName(metric: string): { type: string; fieldKey: string } {
  const parts = metric.split(":");
  return { type: parts[0], fieldKey: parts[parts.length - 1] };
}

export function toPatternDateRefs(
  metric: string,
  observations: { date: string; confounded: boolean; confoundedBy?: string }[],
  wantConfounded: boolean,
): PatternDateRef[] {
  const { type, fieldKey } = parseMetricName(metric);
  return observations
    .filter((o) => o.confounded === wantConfounded)
    .map((o) => ({
      date: o.date,
      type,
      fieldKey,
      confoundedBy: o.confoundedBy,
    }));
}

// The ONE write path both Phase B (correlation) and Phase C (association)
// route through. Re-running with the same inputs updates the existing node
// (via the deterministic id) rather than creating duplicates — this is what
// makes nightly reruns (Phase E) safe later.
export async function upsertPattern(pattern: PatternRecord): Promise<string> {
  const id = buildPatternId(pattern);

  await withSession(async (session) => {
    await session.run(
      `
      MERGE (pat:Pattern {id: $id})
      SET pat.patientId = $patientId,
          pat.method = $method,
          pat.metricA = $metricA,
          pat.metricB = $metricB,
          pat.lagDays = $lagDays,
          pat.direction = $direction,
          pat.strength = $strength,
          pat.confidence = $confidence,
          pat.evidenceCount = $evidenceCount,
          pat.excludedConfounded = $excludedConfounded,
          pat.status = $status,
          pat.updatedAt = datetime()
      ON CREATE SET pat.discoveredAt = datetime()

      WITH pat
      MATCH (p:Patient {id: $patientId})
      MERGE (p)-[:HAS_PATTERN]->(pat)

      // Clear old evidence edges before re-attaching current ones —
      // safe because Pattern is MERGEd, not recreated, so this only
      // touches this pattern's own edges.
      WITH pat
      OPTIONAL MATCH (pat)-[oldRel:SUPPORTED_BY|CONFOUNDED_BY]->()
      DELETE oldRel
      `,
      {
        id,
        patientId: pattern.patientId,
        method: pattern.method,
        metricA: pattern.metricA,
        metricB: pattern.metricB,
        lagDays: pattern.lagDays,
        direction: pattern.direction,
        strength: pattern.strength,
        confidence: pattern.confidence,
        evidenceCount: pattern.evidenceCount,
        excludedConfounded: pattern.excludedConfounded,
        status: pattern.status,
      },
    );

    for (const ref of pattern.supportedDates) {
      await session.run(
        `
        MATCH (pat:Pattern {id: $id})
        MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e {type: $type, date: $date})
        WHERE e[$fieldKey] IS NOT NULL
        MERGE (pat)-[:SUPPORTED_BY]->(e)
        `,
        {
          id,
          patientId: pattern.patientId,
          type: ref.type,
          date: ref.date,
          fieldKey: ref.fieldKey,
        },
      );
    }

    for (const ref of pattern.confoundedDates) {
      await session.run(
        `
        MATCH (pat:Pattern {id: $id})
        MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e {type: $type, date: $date})
        WHERE e[$fieldKey] IS NOT NULL
        MERGE (pat)-[rel:CONFOUNDED_BY]->(e)
        SET rel.confoundedBy = $confoundedBy
        `,
        {
          id,
          patientId: pattern.patientId,
          type: ref.type,
          date: ref.date,
          fieldKey: ref.fieldKey,
          confoundedBy: ref.confoundedBy ?? null,
        },
      );
    }
  });

  return id;
}
