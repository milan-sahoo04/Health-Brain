import { z } from "zod";

/**
 * Dynamic event schema.
 *
 * Only three fields are guaranteed: patientId, date, type.
 * Everything else is open — any additional key/value data is allowed
 * and passed through untouched. This lets the system accept real-world
 * clinical data (Vitals, Symptoms, Visit, or anything else) without
 * requiring a code change every time a new event category appears.
 */
export const eventSchema = z
  .object({
    patientId: z.string().min(1, "patientId is required"),
    date: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "date must be a valid date string (e.g. 2026-01-01)",
    }),
    type: z
      .string()
      .min(1, "type is required")
      .max(50, "type must be 50 characters or fewer"),
  })
  .passthrough(); // keep any extra fields the caller sends, unvalidated in shape

export type Event = z.infer<typeof eventSchema>;

/**
 * Converts a free-text event type into a safe Neo4j node label.
 * Neo4j labels can't be parameterized in Cypher, so this strips
 * anything that isn't a letter or digit before use — critical for
 * preventing Cypher injection now that `type` is arbitrary user input.
 *
 * "Blood Pressure!!" -> "BloodPressureEvent"
 * "vitals"           -> "VitalsEvent"
 */
export function toSafeLabel(rawType: string): string {
  const cleaned = rawType
    .replace(/[^a-zA-Z0-9]/g, "") // strip anything not alphanumeric
    .trim();

  if (cleaned.length === 0) {
    throw new Error("Event type must contain at least one letter or number");
  }

  // Capitalize first letter for a consistent label style
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `${capitalized}Event`;
}
