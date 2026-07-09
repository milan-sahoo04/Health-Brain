// backend/src/db/queries/persistCorrelationResults.ts
import type { CorrelationResult } from "../../services/correlationEngine"; // adjust path to your actual file
import {
  upsertPattern,
  toPatternDateRefs,
  type PatternStatus,
} from "./patternPersistence";

const CORRELATION_ACTIVE_THRESHOLD = 0.3; // tune once you have more real patients — placeholder for now

export async function persistCorrelationResults(
  patientId: string,
  results: CorrelationResult[],
): Promise<string[]> {
  const ids: string[] = [];

  for (const result of results) {
    const status: PatternStatus =
      result.confidence >= CORRELATION_ACTIVE_THRESHOLD
        ? "active"
        : "below_threshold";

    const id = await upsertPattern({
      patientId,
      method: "correlation",
      metricA: result.metricA,
      metricB: result.metricB,
      lagDays: result.lagDays,
      direction: result.direction,
      strength: Math.abs(result.observations[0] ? result.confidence : 0), // see note below
      confidence: result.confidence,
      evidenceCount: result.evidenceCount,
      excludedConfounded: result.excludedConfounded,
      status,
      supportedDates: [
        ...toPatternDateRefs(result.metricA, result.observations, false).map(
          (r) => ({ ...r }),
        ),
      ],
      confoundedDates: [
        ...toPatternDateRefs(result.metricA, result.observations, true).map(
          (r) => ({ ...r }),
        ),
      ],
    });

    ids.push(id);
  }

  return ids;
}
