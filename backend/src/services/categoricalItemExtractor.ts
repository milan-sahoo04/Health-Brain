/**
 * Turns one arbitrary event into zero or more discrete "items" for
 * Association Rule Mining — e.g. a Symptoms event with symptom: "Fatigue"
 * becomes the item "Symptoms:Fatigue". This is the categorical counterpart
 * to metricExtractor.ts (which pulls out NUMBERS); this one pulls out
 * LABELS — things that either happened or didn't, not things with a
 * magnitude. No hardcoded type list, same dynamic principle as the rest
 * of the system.
 */

export interface CategoricalItem {
  item: string; // e.g. "Symptoms:Fatigue", "Medication:Metformin"
  date: string;
}

const METADATA_FIELDS = new Set([
  "id",
  "patientId",
  "date",
  "type",
  "importBatchId",
  "importedAt",
]);

// Same label-field convention as metricExtractor.ts — the field that names
// WHICH specific thing this event is about.
const LABEL_FIELDS = [
  "parameter",
  "metric",
  "drug",
  "symptom",
  "name",
  "doctor",
  "reason",
];

export function extractCategoricalItems(
  event: Record<string, unknown>,
): CategoricalItem[] {
  const { type, date } = event;
  if (typeof type !== "string" || typeof date !== "string") return [];

  const items: CategoricalItem[] = [];

  // Find the first present label field and use it to build one specific item,
  // e.g. type="Symptoms" + symptom="Fatigue" -> "Symptoms:Fatigue"
  for (const key of LABEL_FIELDS) {
    const val = event[key];
    if (typeof val === "string" && val.trim().length > 0) {
      items.push({ item: `${type}:${val.trim()}`, date });
      break; // one item per event is enough — avoids noisy combinatorial explosion
    }
  }

  // Events with no label field at all (e.g. a bare Weight or Lab reading)
  // still count as "this type of thing happened" — useful for rules like
  // "Lab event + Symptom event co-occurring", not just symptom-to-symptom.
  if (items.length === 0) {
    items.push({ item: type, date });
  }

  return items;
}
