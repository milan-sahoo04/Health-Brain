import { Session } from "neo4j-driver";
import {
  extractCategoricalItems,
  CategoricalItem,
} from "./categoricalItemExtractor";

/**
 * Loads every event for a patient and extracts categorical items from each,
 * following the same fetch pattern as timeSeriesBuilder.ts (Phase B) —
 * one query, then run the pure extraction function over each event.
 */
export async function buildPatientCategoricalItems(
  session: Session,
  patientId: string,
): Promise<CategoricalItem[]> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
    RETURN properties(e) AS props
    `,
    { patientId },
  );

  const items: CategoricalItem[] = [];
  for (const record of result.records) {
    const props = record.get("props") as Record<string, unknown>;
    items.push(...extractCategoricalItems(props));
  }

  return items;
}
