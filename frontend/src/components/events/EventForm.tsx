import { useEffect, useState } from "react";
import { createEvent, updateEvent, getDistinctValues } from "../../lib/api";
import type { HealthEvent, HealthEventWithId } from "../../lib/types";
import { COMMON_EVENT_TYPES } from "../../lib/types";

interface EventFormProps {
  patientId: string;
  onSaved?: () => void;
  onCancel?: () => void; // only relevant in edit mode
  editingEvent?: HealthEventWithId; // if provided, form starts in edit mode
}

interface FieldRow {
  id: string; // local key for React list rendering, not sent to backend
  key: string;
  value: string;
}

const RESERVED_KEYS = new Set(["id", "patientId", "date", "type"]);

function makeRowId() {
  return Math.random().toString(36).slice(2);
}

// Turn an existing event's extra fields into editable rows
function eventToRows(event?: HealthEventWithId): FieldRow[] {
  if (!event) return [{ id: makeRowId(), key: "", value: "" }];
  const rows = Object.entries(event)
    .filter(([k]) => !RESERVED_KEYS.has(k))
    .map(([k, v]) => ({
      id: makeRowId(),
      key: k,
      value: v === undefined || v === null ? "" : String(v),
    }));
  return rows.length > 0 ? rows : [{ id: makeRowId(), key: "", value: "" }];
}

export function EventForm({
  patientId,
  onSaved,
  onCancel,
  editingEvent,
}: EventFormProps) {
  const isEditMode = !!editingEvent;

  const [type, setType] = useState(editingEvent?.type ?? "");
  const [date, setDate] = useState(
    editingEvent?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [fields, setFields] = useState<FieldRow[]>(eventToRows(editingEvent));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventTypeSuggestions, setEventTypeSuggestions] =
    useState<string[]>(COMMON_EVENT_TYPES);
  const [fieldNameSuggestions, setFieldNameSuggestions] = useState<string[]>(
    [],
  );

  useEffect(() => {
    getDistinctValues()
      .then(({ eventTypes, fieldNames }) => {
        // merge live values with the seed list, de-duplicated
        setEventTypeSuggestions((prev) =>
          Array.from(new Set([...prev, ...eventTypes])),
        );
        setFieldNameSuggestions(fieldNames);
      })
      .catch(() => {
        // autocomplete is a convenience, not critical — fail silently
      });
  }, []);

  function addField() {
    setFields((prev) => [...prev, { id: makeRowId(), key: "", value: "" }]);
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function updateFieldKey(id: string, key: string) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, key } : f)));
  }

  function updateFieldValue(id: string, value: string) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value } : f)));
  }

  function resetFields() {
    setType("");
    setFields([{ id: makeRowId(), key: "", value: "" }]);
  }

  function buildPayload(): HealthEvent | null {
    if (!type.trim()) return null;

    const extra: Record<string, unknown> = {};
    for (const { key, value } of fields) {
      const trimmedKey = key.trim();
      if (!trimmedKey) continue; // skip empty rows
      if (RESERVED_KEYS.has(trimmedKey)) continue; // don't let user clobber core fields

      // best-effort coercion: numbers stay numbers, everything else stays a string
      const asNumber = Number(value);
      extra[trimmedKey] =
        value.trim() !== "" && !Number.isNaN(asNumber) ? asNumber : value;
    }

    return {
      patientId,
      date,
      type: type.trim(),
      ...extra,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (!payload) {
      setError("Please choose an event type.");
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode) {
        await updateEvent(patientId, editingEvent.id, payload);
      } else {
        await createEvent(payload);
        resetFields();
      }
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setSubmitting(false);
    }
  }

  <datalist id="field-name-suggestions">
    {fieldNameSuggestions.map((f) => (
      <option key={f} value={f} />
    ))}
  </datalist>;

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Event Type{" "}
            {isEditMode && <span className="text-slate-400">(locked)</span>}
          </label>
          <input
            list="event-type-suggestions"
            placeholder="e.g. Lab, Vitals, Symptoms..."
            value={type}
            disabled={isEditMode}
            onChange={(e) => setType(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
          />
          <datalist id="event-type-suggestions">
            {eventTypeSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-600">
          Fields
        </label>
        {fields.map((f) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              list="field-name-suggestions"
              placeholder="Field name (e.g. parameter)"
              value={f.key}
              onChange={(e) => updateFieldKey(f.id, e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Value (e.g. HbA1c)"
              value={f.value}
              onChange={(e) => updateFieldValue(f.id, e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => removeField(f.id)}
              className="text-slate-400 hover:text-red-600 text-sm px-2"
              aria-label="Remove field"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="text-teal-600 hover:text-teal-700 text-sm font-medium"
        >
          + Add Field
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          {submitting ? "Saving..." : isEditMode ? "Save Changes" : "Log Event"}
        </button>
        {isEditMode && (
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-600 hover:text-slate-800 text-sm font-medium px-4 py-2"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
