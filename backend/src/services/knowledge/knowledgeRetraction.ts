import { Session } from "neo4j-driver";
import {
  retractKnowledge,
  RetractionResult,
} from "../../db/queries/knowledgeRetractionPersistence";

/**
 * M6.5.a entrypoint. Thin wrapper — validates input, delegates the
 * actual (idempotent, single-transaction) write to the persistence layer.
 */
export async function retract(
  session: Session,
  knowledgeId: string,
  reason: string,
): Promise<RetractionResult> {
  if (!reason || reason.trim().length === 0) {
    throw new Error("A retraction reason is required.");
  }
  return retractKnowledge(session, knowledgeId, reason.trim());
}
