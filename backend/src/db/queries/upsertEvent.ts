import { Session } from "neo4j-driver";
import { Event, toSafeLabel } from "../../schemas/event.schema";

/**
 * Writes one event into the graph:
 * 1. MERGE ensures the Patient node exists
 * 2. CREATE makes a new event node, labeled dynamically based on `type`
 * 3. HAS_EVENT connects Patient -> event node
 */
export async function upsertEvent(session: Session, event: Event) {
  const label = toSafeLabel(event.type); // sanitized before ever touching the query string

  const query = `
    MERGE (p:Patient {id: $patientId})
    CREATE (e:${label} $props)
    CREATE (p)-[:HAS_EVENT]->(e)
    RETURN p, e
  `;

  const result = await session.run(query, {
    patientId: event.patientId,
    props: event,
  });

  return result.records[0];
}
