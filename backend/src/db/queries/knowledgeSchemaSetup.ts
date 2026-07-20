import { Session } from "neo4j-driver";

/**
 * Idempotent schema setup for M6. Safe to run repeatedly — IF NOT EXISTS
 * means this never fails or duplicates. Resolves the open question from
 * the M6.4 architecture review: the Knowledge.id uniqueness guarantee
 * that makes batched idempotency safe at the database level, not just
 * the application level.
 */
export async function ensureKnowledgeSchema(session: Session): Promise<void> {
  await session.run(
    `CREATE CONSTRAINT knowledge_id_unique IF NOT EXISTS FOR (k:Knowledge) REQUIRE k.id IS UNIQUE`,
  );
  await session.run(
    `CREATE INDEX knowledge_version_knowledgeid IF NOT EXISTS FOR (v:KnowledgeVersion) ON (v.knowledgeId)`,
  );
}
