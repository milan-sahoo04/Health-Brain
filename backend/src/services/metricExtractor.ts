/**
 * Turns one arbitrary event object into zero or more (metricName, value) pairs.
 *
 * Fully generic — no hardcoded event types. Because events are dynamic (Step 22),
 * a new type invented tomorrow (e.g. "SleepScore") is picked up automatically,
 * with no code change here. This must never throw — it runs over uncontrolled
 * historical data every night.
 *
 * Convention:
 * 1. A "label" field (first match from LABEL_FIELDS) names WHAT is being measured,
 *    e.g. parameter: "HbA1c", drug: "Metformin", symptom: "Fever".
 * 2. Any other numeric field on the event is a trackable value.
 * 3. A field literally named "value" keeps clean naming (Lab:HbA1c).
 *    Any other field name is appended to disambiguate (Weight:valueKg,
 *    Medication:Metformin:adherencePercent) — self-documenting, and safe
 *    if an event ever has more than one numeric field.
 */

export interface MetricPoint {
  metricName: string;
  value: number;
  date: string;
}

// Fields that name WHAT is being measured, in priority order.
// Extend this list — not a switch statement — if a new convention emerges.
const LABEL_FIELDS = [
  "parameter",
  "metric",
  "drug",
  "symptom",
  "name",
  "test",
  "label",
];

// Fields that are never candidate metric values, regardless of event type.
const RESERVED_KEYS = new Set([
  "id",
  "patientId",
  "date",
  "type",
  "importBatchId",
  "importedAt",
]);

function findLabel(event: Record<string, unknown>): string | null {
  for (const field of LABEL_FIELDS) {
    const val = event[field];
    if (typeof val === "string" && val.trim() !== "") return val;
  }
  return null;
}

export function extractMetrics(event: Record<string, unknown>): MetricPoint[] {
  const { type, date } = event;

  if (typeof type !== "string" || typeof date !== "string") return [];

  const label = findLabel(event);
  const labelFieldKey = LABEL_FIELDS.find(
    (f) => typeof event[f] === "string" && event[f] === label,
  );

  const points: MetricPoint[] = [];

  for (const [key, rawValue] of Object.entries(event)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key === labelFieldKey) continue; // the label itself isn't a value
    if (typeof rawValue === "boolean") continue; // flags aren't measurements — leave to Phase C

    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) continue; // skips non-numeric strings, e.g. "128/82"

    const metricName =
      key === "value"
        ? label
          ? `${type}:${label}`
          : type
        : label
          ? `${type}:${label}:${key}`
          : `${type}:${key}`;

    points.push({ metricName, value, date });
  }

  return points;
}
