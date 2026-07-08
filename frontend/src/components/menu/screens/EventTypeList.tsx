// frontend/src/components/menu/screens/EventTypeList.tsx
import { useEffect, useState } from "react";
import { getEventSeries, type SeriesEvent } from "../../../lib/api";

interface EventTypeListProps {
  patientId: string;
  eventType: string; // e.g. "Medication" or "Condition"
  emptyHint: string; // shown when there's genuinely nothing logged yet
}

export function EventTypeList({
  patientId,
  eventType,
  emptyHint,
}: EventTypeListProps) {
  const [events, setEvents] = useState<SeriesEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getEventSeries(patientId, eventType)
      .then(({ series }) => setEvents([...series].reverse())) // most recent first
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, [patientId, eventType]);

  if (loading)
    return <p className="text-sm text-slate-400 px-3 py-4">Loading...</p>;
  if (error) return <p className="text-sm text-red-600 px-3 py-4">{error}</p>;
  if (events.length === 0)
    return <p className="text-sm text-slate-400 px-3 py-4">{emptyHint}</p>;

  return (
    <div className="divide-y divide-slate-100">
      {events.map((e) => (
        <div key={e.id} className="px-3 py-2">
          <div className="flex justify-between text-sm text-slate-700">
            <span>{String(e.parameter ?? e.drug ?? e.type)}</span>
            <span className="text-slate-400">{e.date}</span>
          </div>
          {Object.entries(e)
            .filter(
              ([k]) =>
                ![
                  "id",
                  "patientId",
                  "date",
                  "type",
                  "parameter",
                  "drug",
                ].includes(k),
            )
            .map(([k, v]) => (
              <div key={k} className="text-xs text-slate-500">
                {k}: {String(v)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
