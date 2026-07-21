import { WikiKnowledgeItem, WikiRetrievalResult } from "./wikiRetriever";
import { WikiSectionKey } from "../../models/wiki";
import { toNumberSafe } from "./neo4jNumberUtil";
import { cleanDescriptionText, formatMetricName } from "./metricNameFormatter";

export interface BuiltSection {
  sectionKey: WikiSectionKey;
  title: string;
  content: string;
}

const CONFIDENCE_HIGH = 0.6;
const CONFIDENCE_MODERATE = 0.4;

function confidenceLabel(c: number): string {
  return c >= CONFIDENCE_HIGH
    ? "High"
    : c >= CONFIDENCE_MODERATE
      ? "Moderate"
      : "Low";
}

function claimText(item: WikiKnowledgeItem): string {
  const [a, b] = item.involvedMetricNames;
  return `${formatMetricName(a)} and ${formatMetricName(b)} show a ${confidenceLabel(item.currentConfidence).toLowerCase()}-confidence relationship`;
}

// --- Overview ---
function buildOverview(data: WikiRetrievalResult): BuiltSection {
  const count = data.knowledgeItems.length;
  const content =
    count === 0
      ? "No confirmed health patterns yet. As more data is logged and evaluated, this profile will update automatically."
      : `This profile currently tracks ${count} confirmed health pattern${count === 1 ? "" : "s"}, ` +
        `derived from evidence-based analysis of logged health events.`;
  return { sectionKey: "overview", title: "Overview", content };
}

// --- Current Conditions ---
function buildCurrentConditions(data: WikiRetrievalResult): BuiltSection {
  if (data.knowledgeItems.length === 0) {
    return {
      sectionKey: "currentConditions",
      title: "Current Conditions",
      content: "No active conditions tracked yet.",
    };
  }
  const metrics = new Set<string>();
  data.knowledgeItems.forEach((k) =>
    k.involvedMetricNames.forEach((m) => metrics.add(formatMetricName(m))),
  );
  const content = `Tracked metrics: ${[...metrics].join(", ")}.`;
  return {
    sectionKey: "currentConditions",
    title: "Current Conditions",
    content,
  };
}

// --- Health Timeline ---
function buildHealthTimeline(data: WikiRetrievalResult): BuiltSection {
  const allEvidence = data.knowledgeItems.flatMap((k) => k.evidence);
  if (allEvidence.length === 0) {
    return {
      sectionKey: "healthTimeline",
      title: "Health Timeline",
      content: "No timeline data available yet.",
    };
  }
  // Evidence descriptions carry the real event dates as free text (M5's
  // temporal_alignment format) — sorted by createdAt as a stable proxy
  // ordering since evidence doesn't carry a separate structured event
  // date field at this layer.
  const lines = [...allEvidence]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((e) => `- ${cleanDescriptionText(e.description)}`);
  return {
    sectionKey: "healthTimeline",
    title: "Health Timeline",
    content: lines.join("\n"),
  };
}

// --- Major Insights ---
function buildMajorInsights(data: WikiRetrievalResult): BuiltSection {
  const insights = data.knowledgeItems.filter(
    (k) => k.currentConfidence >= CONFIDENCE_MODERATE,
  );
  if (insights.length === 0) {
    return {
      sectionKey: "majorInsights",
      title: "Major Insights",
      content: "No high-confidence insights identified yet.",
    };
  }
  const lines = insights
    .sort((a, b) => b.currentConfidence - a.currentConfidence)
    .map(
      (k) =>
        `- ${claimText(k)} (confidence: ${(k.currentConfidence * 100).toFixed(0)}%).`,
    );
  return {
    sectionKey: "majorInsights",
    title: "Major Insights",
    content: lines.join("\n"),
  };
}

// --- Primary / Secondary Drivers ---
function buildPrimaryDrivers(data: WikiRetrievalResult): BuiltSection {
  const sorted = [...data.knowledgeItems].sort(
    (a, b) => b.currentConfidence - a.currentConfidence,
  );
  const primary = sorted[0];
  const content = primary
    ? `Primary driver: ${formatMetricName(primary.involvedMetricNames[0])} (confidence ${(primary.currentConfidence * 100).toFixed(0)}%).`
    : "No primary driver identified yet.";
  return { sectionKey: "primaryDrivers", title: "Primary Drivers", content };
}

function buildSecondaryDrivers(data: WikiRetrievalResult): BuiltSection {
  const sorted = [...data.knowledgeItems].sort(
    (a, b) => b.currentConfidence - a.currentConfidence,
  );
  const secondary = sorted.slice(1);
  const content =
    secondary.length === 0
      ? "No secondary drivers identified yet."
      : secondary
          .map(
            (k) =>
              `- ${formatMetricName(k.involvedMetricNames[0])} (confidence ${(k.currentConfidence * 100).toFixed(0)}%)`,
          )
          .join("\n");
  return {
    sectionKey: "secondaryDrivers",
    title: "Secondary Drivers",
    content,
  };
}

// --- Risk Assessment ---
function buildRiskAssessment(data: WikiRetrievalResult): BuiltSection {
  const declining = data.knowledgeItems.filter(
    (k) => k.confidenceTrend === "declining",
  );
  const content =
    declining.length > 0
      ? `Moderate: ${declining.length} tracked pattern${declining.length === 1 ? " is" : "s are"} showing declining confidence and may need review.`
      : "Low: no patterns currently show a declining trend.";
  return { sectionKey: "riskAssessment", title: "Risk Assessment", content };
}

// --- Confidence Analysis ---
function buildConfidenceAnalysis(data: WikiRetrievalResult): BuiltSection {
  if (data.knowledgeItems.length === 0) {
    return {
      sectionKey: "confidenceAnalysis",
      title: "Confidence Analysis",
      content: "No confidence data available yet.",
    };
  }
  const lines = data.knowledgeItems.map(
    (k) =>
      `- ${claimText(k)}: ${(k.currentConfidence * 100).toFixed(1)}% (${confidenceLabel(k.currentConfidence)}, trend: ${k.confidenceTrend}, ` +
      `${toNumberSafe(k.versionCount)} version${toNumberSafe(k.versionCount) === 1 ? "" : "s"}).`,
  );
  return {
    sectionKey: "confidenceAnalysis",
    title: "Confidence Analysis",
    content: lines.join("\n"),
  };
}

// --- Supporting Evidence ---
function buildSupportingEvidence(data: WikiRetrievalResult): BuiltSection {
  const allEvidence = data.knowledgeItems.flatMap((k) => k.evidence);
  if (allEvidence.length === 0) {
    return {
      sectionKey: "supportingEvidence",
      title: "Supporting Evidence",
      content: "No supporting evidence recorded yet.",
    };
  }
  const supporting = allEvidence.filter(
    (e) => e.polarity === "supporting",
  ).length;
  const contradicting = allEvidence.filter(
    (e) => e.polarity === "contradicting",
  ).length;
  const lines = [
    `${supporting} supporting observation${supporting === 1 ? "" : "s"}, ${contradicting} contradicting.`,
    ...allEvidence
      .slice(0, 10)
      .map((e) => `- (${e.polarity}) ${cleanDescriptionText(e.description)}`),
  ];
  return {
    sectionKey: "supportingEvidence",
    title: "Supporting Evidence",
    content: lines.join("\n"),
  };
}

/**
 * Runs all 9 builders over one retrieval result. Pure — no I/O, fully
 * unit-testable without Neo4j, same discipline as isSignificantChange
 * (M6.3.a) and evaluateAutoRetract (M6.5.d).
 */
export function buildAllSections(data: WikiRetrievalResult): BuiltSection[] {
  return [
    buildOverview(data),
    buildCurrentConditions(data),
    buildHealthTimeline(data),
    buildMajorInsights(data),
    buildPrimaryDrivers(data),
    buildSecondaryDrivers(data),
    buildRiskAssessment(data),
    buildConfidenceAnalysis(data),
    buildSupportingEvidence(data),
  ];
}
