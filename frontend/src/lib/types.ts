// Mirrors backend/src/schemas/event.schema.ts — fully dynamic now.
// Only patientId, date, and type are guaranteed. Everything else is open.

export interface HealthEvent {
  patientId: string;
  date: string; // ISO date string, e.g. "2026-01-01"
  type: string; // any free-text label: "Lab", "Vitals", "Symptoms", etc.
  [key: string]: unknown; // any additional fields the event carries
}

export type HealthEventWithId = HealthEvent & { id: string };

// A handful of common types offered as quick suggestions in the form —
// not a restriction, just convenience autocomplete.
export const COMMON_EVENT_TYPES = [
  "Lab",
  "Medication",
  "Lifestyle",
  "Weight",
  "Vitals",
  "Symptoms",
  "Visit",
];
