import { withSession } from "../db/neo4j";
import { promotePatientKnowledge } from "../services/knowledge/knowledgePromoter";

async function main() {
  const patientIds = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (p:Patient) RETURN p.id AS id ORDER BY p.id`,
    );
    return result.records.map((r) => r.get("id") as string);
  });

  console.log(`Running M6 promotion for ${patientIds.length} patients...\n`);

  let totalPromoted = 0;
  for (const patientId of patientIds) {
    try {
      const summary = await withSession((session) =>
        promotePatientKnowledge(session, patientId),
      );
      console.log(
        `${patientId}: ${summary.acceptedCandidateCount} accepted -> create=${summary.byAction.create}, append=${summary.byAction.append_version}, no_op=${summary.byAction.no_op}`,
      );
      totalPromoted += summary.acceptedCandidateCount;
    } catch (err) {
      console.error(
        `  FAILED for ${patientId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `\n--- Total accepted candidates promoted across ${patientIds.length} patients: ${totalPromoted} ---`,
  );
}

main().catch((err) => {
  console.error("Promotion batch run failed:", err);
  process.exit(1);
});
