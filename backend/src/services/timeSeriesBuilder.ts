import { Session } from "neo4j-driver";
import { extractMetrics, MetricPoint } from "./metricExtractor";

// A point WITHIN an already-grouped series — no metricName needed here,
// since the series itself carries that. Distinct from metricExtractor's
// MetricPoint, which is for raw, ungrouped extraction output.
export interface SeriesPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  metricName: string;
  points: SeriesPoint[]; // sorted ascending by date
}

/**
 * Loads every event for a patient and groups their numeric values into
 * per-metric time series, e.g. "Lab:HbA1c" -> [{date, value}, ...].
 */
export async function buildPatientMetricSeries(
  session: Session,
  patientId: string,
): Promise<Map<string, MetricSeries>> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
    RETURN properties(e) AS props
    `,
    { patientId },
  );

  const seriesMap = new Map<string, MetricSeries>();

  for (const record of result.records) {
    const props = record.get("props") as Record<string, unknown>;
    const points: MetricPoint[] = extractMetrics(props);

    for (const point of points) {
      if (!seriesMap.has(point.metricName)) {
        seriesMap.set(point.metricName, {
          metricName: point.metricName,
          points: [],
        });
      }
      seriesMap.get(point.metricName)!.points.push({
        date: point.date,
        value: point.value,
      });
    }
  }

  for (const series of seriesMap.values()) {
    series.points.sort((a, b) => a.date.localeCompare(b.date));
  }

  return seriesMap;
}
