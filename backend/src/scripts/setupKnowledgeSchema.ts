// backend/src/scripts/setupKnowledgeSchema.ts
import { withSession } from "../db/neo4j";
import { ensureKnowledgeSchema } from "../db/queries/knowledgeSchemaSetup";

withSession((session) => ensureKnowledgeSchema(session))
  .then(() => console.log("Knowledge schema constraints/indexes ensured."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
