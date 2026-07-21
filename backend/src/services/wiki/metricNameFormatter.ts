/**
 * Cleans metricExtractor.ts-style names ("HbA1c:HbA1c", "Lab:HbA1c",
 * "Medication:Metformin:adherencePercent") into human-readable labels for
 * wiki text. Deduplicates repeated segments (the "HbA1c:HbA1c" case we
 * saw in pattern-demo-1, which happens when an event's type and its
 * label field happen to be identical) without touching metricExtractor.ts
 * itself, which works correctly and is out of scope to modify.
 */
export function formatMetricName(rawName: string): string {
  const parts = rawName.split(":");
  const unique = parts.filter((part, i) => i === 0 || part !== parts[i - 1]);
  return unique.join(" ");
}

// --- add to metricNameFormatter.ts ---
/**
 * Cleans the specific "X:X" duplicate-segment pattern that appears
 * inside already-composed Evidence.description strings from M5
 * (e.g. "HbA1c:HbA1c (9.35)" -> "HbA1c (9.35)"). Narrower than
 * formatMetricName — only fixes the doubled-segment case, doesn't
 * attempt full reformatting of a sentence that's already built.
 */
export function cleanDescriptionText(description: string): string {
  return description.replace(/\b(\w[\w\s]*?):\1\b/g, "$1");
}
