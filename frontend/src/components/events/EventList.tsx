import { useEffect, useState } from "react";
import { getPatientEvents, deleteEvent } from "../../lib/api";
import type { HealthEventWithId } from "../../lib/types";
import { EventForm } from "./EventForm";

interface EventListProps {
  patientId: string;
}

// Deterministic accent color per event type, so repeated types stay visually consistent
const TYPE_COLORS: Record<string, string> = {
  Lab: "#3F7D58",
  Medication: "#C97B3D",
  Lifestyle: "#4C7EA8",
  Weight: "#8A6FA8",
  Vitals: "#3F7D58",
  Symptoms: "#B3492F",
  Visit: "#6B7280",
};

function colorForType(type: string) {
  return TYPE_COLORS[type] ?? "#6B7280";
}

export function EventList({ patientId }: EventListProps) {
  const [events, setEvents] = useState<HealthEventWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getPatientEvents(patientId);
      setEvents(data.events as HealthEventWithId[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [patientId]);

  async function handleDelete(eventId: string) {
    setDeletingId(eventId);
    try {
      await deleteEvent(patientId, eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete event");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <p className="text-sm text-[#8A8577]">Loading events…</p>;
  if (error) return <p className="text-sm text-[#B3492F]">Error: {error}</p>;
  if (events.length === 0)
    return (
      <p className="text-sm text-[#8A8577]">No events yet for {patientId}.</p>
    );

  return (
    <ul className="space-y-2">
      {events.map((event) =>
        editingId === event.id ? (
          <li key={event.id}>
            <EventForm
              patientId={patientId}
              editingEvent={event}
              onSaved={() => {
                setEditingId(null);
                load();
              }}
              onCancel={() => setEditingId(null)}
            />
          </li>
        ) : (
          <li
            key={event.id}
            className="border-l-2 rounded-r-lg bg-white shadow-sm overflow-hidden"
            style={{ borderLeftColor: colorForType(event.type) }}
          >
            <div className="flex justify-between items-center px-4 py-3">
              <button
                onClick={() =>
                  setExpandedId(expandedId === event.id ? null : event.id)
                }
                className="flex items-center gap-2 text-left"
              >
                <span
                  className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full"
                  style={{
                    color: colorForType(event.type),
                    backgroundColor: `${colorForType(event.type)}1A`,
                  }}
                >
                  {event.type}
                </span>
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#8A8577] font-mono">
                  {event.date}
                </span>
                <button
                  onClick={() => setEditingId(event.id)}
                  className="text-xs text-[#C97B3D] hover:text-[#DB9958] font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(event.id)}
                  disabled={deletingId === event.id}
                  className="text-xs text-[#B3492F] hover:text-[#CC5A3D] font-medium disabled:opacity-50"
                >
                  {deletingId === event.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
            {expandedId === event.id && (
              <pre className="text-xs text-[#5A5648] font-mono bg-[#FAFAF7] px-4 py-3 border-t border-[#E4E1D8] overflow-x-auto">
                {JSON.stringify(event, null, 2)}
              </pre>
            )}
          </li>
        ),
      )}
    </ul>
  );
}
