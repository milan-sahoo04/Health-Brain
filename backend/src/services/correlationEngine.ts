import * as ss from "simple-statistics";
import type { TimelineEntry } from "./eventTimeline";
import type { MetricSeries, SeriesPoint } from "./timeSeriesBuilder";

const MIN_POINTS_FOR_CANDIDATE = 5;
const MIN_CLEAN_OBSERVATIONS_TO_SCORE = 3;
const MIN_POINTS_FOR_TREND_FIT = 3; // below this, detrending isn't reliable — fall back to raw values
const LAG_DAYS = [0, 7, -7, 14, -14, 30, -30];
const DATE_TOLERANCE_DAYS = 3;
const CONFOUNDER_WINDOW_DAYS = 3;

// Only these event types are treated as potential confounders. Routine
// repeated measurements (Lab, Weight, Lifestyle, Medication adherence) are
// exactly what we're trying to correlate — they can't also confound each
// other. A confounder must represent a genuine STATE CHANGE: a new symptom,
// an illness, or a medication being added/changed (not just logged again).
const CONFOUNDER_ELIGIBLE_TYPES = new Set([
  "Symptom",
  "Symptoms",
  "Illness",
  "Visit",
]);

function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return (new Date(b).getTime() - new Date(a).getTime()) / msPerDay;
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// All unique pairs of metric series with enough points to bother testing.
export function findCandidatePairs(
  seriesMap: Map<string, MetricSeries>,
): [MetricSeries, MetricSeries][] {
  const eligible = Array.from(seriesMap.values()).filter(
    (s) => s.points.length >= MIN_POINTS_FOR_CANDIDATE,
  );

  const pairs: [MetricSeries, MetricSeries][] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      pairs.push([eligible[i], eligible[j]]);
    }
  }
  return pairs;
}

function findClosestPoint(
  points: SeriesPoint[],
  targetDate: string,
  toleranceDays: number,
): SeriesPoint | null {
  let best: SeriesPoint | null = null;
  let bestDiff = Infinity;

  for (const point of points) {
    const diff = Math.abs(daysBetween(point.date, targetDate));
    if (diff <= toleranceDays && diff < bestDiff) {
      best = point;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * NEW — fits a linear trend (value vs. days-since-first-point) for a series
 * and returns date -> residual (actual minus trend-predicted). This is what
 * stops two metrics that both just drift steadily in one direction over
 * months (e.g. weight slowly dropping, HbA1c slowly dropping) from showing
 * a strong "correlation" that's really just shared drift, not a real link.
 * Falls back to raw values if there aren't enough points to fit a trend.
 */
function computeResiduals(series: MetricSeries): Map<string, number> {
  const residuals = new Map<string, number>();

  if (series.points.length < MIN_POINTS_FOR_TREND_FIT) {
    for (const p of series.points) residuals.set(p.date, p.value);
    return residuals;
  }

  const firstDate = series.points[0].date;
  const trendInput: [number, number][] = series.points.map((p) => [
    daysBetween(firstDate, p.date),
    p.value,
  ]);

  const model = ss.linearRegression(trendInput);
  const line = ss.linearRegressionLine(model);

  for (const p of series.points) {
    const predicted = line(daysBetween(firstDate, p.date));
    residuals.set(p.date, p.value - predicted);
  }

  return residuals;
}

// Type-agnostic by design — no hardcoded list of "confounder types."
function findConfounder(
  timeline: TimelineEntry[],
  date: string,
  excludeTypes: Set<string>,
): string | null {
  for (const entry of timeline) {
    if (excludeTypes.has(entry.type)) continue;
    if (!CONFOUNDER_ELIGIBLE_TYPES.has(entry.type)) continue;
    if (Math.abs(daysBetween(entry.date, date)) <= CONFOUNDER_WINDOW_DAYS) {
      return entry.type;
    }
  }
  return null;
}

export interface AlignedObservation {
  dateA: string;
  dateB: string;
  valueA: number; // raw value, for human readability
  valueB: number; // raw value, for human readability
  residualA: number; // NEW — deviation from metric A's own trend, used for correlation math
  residualB: number; // NEW — deviation from metric B's own trend, used for correlation math
  confounded: boolean;
  confoundedBy?: string;
}

export interface CorrelationResult {
  metricA: string;
  metricB: string;
  lagDays: number;
  direction: "direct" | "inverse";
  confidence: number;
  evidenceCount: number;
  excludedConfounded: number;
  observations: AlignedObservation[];
}

function alignAtLag(
  seriesA: MetricSeries,
  seriesB: MetricSeries,
  residualsA: Map<string, number>,
  residualsB: Map<string, number>,
  lagDays: number,
) {
  const aligned: {
    dateA: string;
    dateB: string;
    valueA: number;
    valueB: number;
    residualA: number;
    residualB: number;
  }[] = [];

  for (const pointA of seriesA.points) {
    const targetDate = addDays(pointA.date, lagDays);
    const matchB = findClosestPoint(
      seriesB.points,
      targetDate,
      DATE_TOLERANCE_DAYS,
    );
    if (matchB) {
      aligned.push({
        dateA: pointA.date,
        dateB: matchB.date,
        valueA: pointA.value,
        valueB: matchB.value,
        residualA: residualsA.get(pointA.date) ?? pointA.value,
        residualB: residualsB.get(matchB.date) ?? matchB.value,
      });
    }
  }
  return aligned;
}

// Tests a metric pair across several lag windows, excludes confounded
// observations BEFORE scoring, and returns the strongest honestly-supported
// relationship — or null if there isn't enough clean evidence yet.
export function correlateMetricPair(
  seriesA: MetricSeries,
  seriesB: MetricSeries,
  timeline: TimelineEntry[],
  typeA: string,
  typeB: string,
): CorrelationResult | null {
  let best: CorrelationResult | null = null;

  // Fit each series' own trend ONCE, outside the lag loop — same residuals
  // are reused across every lag window tested below.
  const residualsA = computeResiduals(seriesA);
  const residualsB = computeResiduals(seriesB);

  for (const lag of LAG_DAYS) {
    const aligned = alignAtLag(seriesA, seriesB, residualsA, residualsB, lag);
    if (aligned.length < MIN_CLEAN_OBSERVATIONS_TO_SCORE) continue;

    const excludeTypes = new Set([typeA, typeB]);
    const observations: AlignedObservation[] = aligned.map((a) => {
      const confoundedBy =
        findConfounder(timeline, a.dateA, excludeTypes) ??
        findConfounder(timeline, a.dateB, excludeTypes);
      return {
        ...a,
        confounded: confoundedBy !== null,
        confoundedBy: confoundedBy ?? undefined,
      };
    });

    const clean = observations.filter((o) => !o.confounded);

    // TEMPORARY diagnostic — remove once results look right.
    console.log(
      `[correlation] ${seriesA.metricName} vs ${seriesB.metricName} @ lag ${lag}: ` +
        `aligned=${aligned.length}, clean=${clean.length}, ` +
        `confoundedBy=[${observations
          .filter((o) => o.confounded)
          .map((o) => o.confoundedBy)
          .join(", ")}]`,
    );

    if (clean.length < MIN_CLEAN_OBSERVATIONS_TO_SCORE) continue;

    // CHANGED — correlate RESIDUALS, not raw values. This is the actual fix.
    const residA = clean.map((o) => o.residualA);
    const residB = clean.map((o) => o.residualB);

    let correlation: number;
    try {
      correlation = ss.sampleCorrelation(residA, residB);
    } catch {
      continue;
    }
    if (!Number.isFinite(correlation)) continue;

    const frequency = Math.min(1, clean.length / 10);
    const strength = Math.abs(correlation);

    // CHANGED — consistency now checks agreement on RESIDUALS, matching
    // what was actually correlated above.
    const meanResidA = ss.mean(residA);
    const meanResidB = ss.mean(residB);
    const agreeCount = clean.filter((o) => {
      const sameDirection =
        (o.residualA - meanResidA) * (o.residualB - meanResidB) >= 0;
      return correlation >= 0 ? sameDirection : !sameDirection;
    }).length;
    const consistency = agreeCount / clean.length;

    const mostRecentDate = clean.reduce(
      (latest, o) => (o.dateA > latest ? o.dateA : latest),
      clean[0].dateA,
    );
    const daysSinceRecent = Math.max(
      0,
      daysBetween(mostRecentDate, new Date().toISOString().slice(0, 10)),
    );
    const recency = Math.max(0.3, 1 - daysSinceRecent / 90);

    const confidence = frequency * strength * consistency * recency;

    const result: CorrelationResult = {
      metricA: seriesA.metricName,
      metricB: seriesB.metricName,
      lagDays: lag,
      direction: correlation >= 0 ? "direct" : "inverse",
      confidence,
      evidenceCount: clean.length,
      excludedConfounded: observations.length - clean.length,
      observations,
    };

    if (!best || result.confidence > best.confidence) best = result;
  }

  return best;
}
