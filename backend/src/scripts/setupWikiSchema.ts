import { withSession } from "../db/neo4j";
import { ensureWikiSchema } from "../db/queries/knowledgeSchemaSetup";

withSession((session) => ensureWikiSchema(session))
  .then(() => console.log("Wiki schema constraints/indexes ensured."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
