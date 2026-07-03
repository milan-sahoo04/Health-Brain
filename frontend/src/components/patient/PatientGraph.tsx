import { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { getPatientGraph } from "../../lib/api";

interface PatientGraphProps {
  patientId: string;
}

// Same accent family as event cards, so the graph reads as an
// extension of the record rather than a separate visualization.
const NODE_COLORS: Record<string, string> = {
  Patient: "#1B2430",
  Lab: "#3F7D58",
  LabEvent: "#3F7D58",
  Medication: "#C97B3D",
  MedicationEvent: "#C97B3D",
  Lifestyle: "#4C7EA8",
  LifestyleEvent: "#4C7EA8",
  Weight: "#8A6FA8",
  WeightEvent: "#8A6FA8",
  Vitals: "#3F7D58",
  VitalsEvent: "#3F7D58",
  Symptoms: "#B3492F",
  SymptomsEvent: "#B3492F",
  Visit: "#6B7280",
  VisitEvent: "#6B7280",
};

const FALLBACK_COLOR = "#8A8577";

function colorForLabel(label: string) {
  return NODE_COLORS[label] || FALLBACK_COLOR;
}

interface ForceGraphNode {
  id: string;
  name: string;
  color: string;
  label: string;
  raw: Record<string, unknown>;
}

interface ForceGraphLink {
  source: string;
  target: string;
  label: string;
}

export function PatientGraph({ patientId }: PatientGraphProps) {
  const [data, setData] = useState<{
    nodes: ForceGraphNode[];
    links: ForceGraphLink[];
  }>({
    nodes: [],
    links: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const graph = await getPatientGraph(patientId);

        const nodes: ForceGraphNode[] = graph.nodes.map((n) => ({
          id: n.id,
          name:
            n.label === "Patient"
              ? String(n.properties.id)
              : // eslint-disable-next-line react-hooks/immutability
                `${n.label}\n${summarizeProps(n.properties)}`,
          color: colorForLabel(n.label),
          label: n.label,
          raw: n.properties,
        }));

        const links: ForceGraphLink[] = graph.edges.map((e) => ({
          source: e.source,
          target: e.target,
          label: e.label,
        }));

        if (!cancelled) setData({ nodes, links });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load graph");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  function summarizeProps(props: Record<string, unknown>): string {
    if ("parameter" in props) return `${props.parameter}: ${props.value}`;
    if ("drug" in props) return `${props.drug} ${props.dose}`;
    if ("metric" in props) return `${props.metric}: ${props.value}`;
    if ("valueKg" in props) return `${props.valueKg} kg`;
    // dynamic events: show up to two non-reserved fields
    const entries = Object.entries(props).filter(
      ([k]) => !["id", "patientId", "date", "type"].includes(k),
    );
    return entries
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }

  if (loading) return <p className="text-sm text-[#8A8577]">Loading graph…</p>;
  if (error) return <p className="text-sm text-[#B3492F]">Error: {error}</p>;
  if (data.nodes.length === 0)
    return (
      <p className="text-sm text-[#8A8577]">
        No graph data for {patientId} yet.
      </p>
    );

  // Build a legend from the labels actually present in this graph
  const presentLabels = Array.from(
    new Set(data.nodes.map((n) => n.label)),
  ).sort((a, b) =>
    a === "Patient" ? -1 : b === "Patient" ? 1 : a.localeCompare(b),
  );

  return (
    <div className="border border-[#E4E1D8] rounded-lg bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#E4E1D8] bg-[#FAFAF7] flex-wrap">
        {presentLabels.map((label) => (
          <span
            key={label}
            className="flex items-center gap-1.5 text-[11px] text-[#5A5648]"
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: colorForLabel(label) }}
            />
            {label}
          </span>
        ))}
      </div>

      <div ref={containerRef} style={{ height: 400 }}>
        <ForceGraph2D
          graphData={data}
          backgroundColor="#FAFAF7"
          nodeLabel={(node) => (node as ForceGraphNode).name}
          nodeColor={(node) => (node as ForceGraphNode).color}
          linkLabel={(link) => (link as ForceGraphLink).label}
          linkColor={() => "#D8D4C8"}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowColor={() => "#B8B3A3"}
          nodeRelSize={6}
          // eslint-disable-next-line react-hooks/refs
          width={containerRef.current?.clientWidth || 600}
          height={400}
        />
      </div>
    </div>
  );
}
