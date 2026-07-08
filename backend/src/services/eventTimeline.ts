import { Session } from "neo4j-driver";

export interface TimelineEntry {
  date: string;
  type: string;
}

// Lightweight (date, type) timeline for one patient — used only to check
// "was some other kind of event happening nearby" during confounder detection.
// Deliberately excludes event values; confounder checks don't need them.
export async function buildEventTimeline(
  session: Session,
  patientId: string,
): Promise<TimelineEntry[]> {
  const result = await session.run(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
    WHERE e.date IS NOT NULL AND e.type IS NOT NULL
    RETURN e.date AS date, e.type AS type
    `,
    { patientId },
  );

  return result.records.map((r) => ({
    date: r.get("date") as string,
    type: r.get("type") as string,
  }));
}
