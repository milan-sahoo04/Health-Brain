import { withSession } from "../db/neo4j";
import { runEvidenceReasoningEngine } from "../services/ere/ereOrchestrator";

/**
 * Runs the full M5 pipeline across every patient with events — the
 * validation entrypoint for M5.6. Not a route (same reasoning as
 * trainGnnModel.ts): this reads across all patients, and there's no
 * legitimate frontend/external use case for triggering that in one call.
 *
 * Run with: npx ts-node --transpile-only src/scripts/runEreForAllPatients.ts
 */
async function main() {
  const patientIds = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (p:Patient) RETURN p.id AS id ORDER BY p.id`,
    );
    return result.records.map((r) => r.get("id") as string);
  });

  console.log(`Running ERE for ${patientIds.length} patients...\n`);

  const allResults = [];
  for (const patientId of patientIds) {
    try {
      const summary = await runEvidenceReasoningEngine(patientId);
      console.log(
        `${patientId}: ${summary.hypothesesEvaluated} hypotheses -> ` +
          `accepted=${summary.byStatus.accepted}, rejected=${summary.byStatus.rejected}, inconclusive=${summary.byStatus.inconclusive}`,
      );
      allResults.push({ patientId, ...summary.byStatus });
    } catch (err) {
      console.error(
        `  FAILED for ${patientId}:`,
        err instanceof Error ? err.message : err,
      );
      allResults.push({
        patientId,
        accepted: 0,
        rejected: 0,
        inconclusive: 0,
        error: true,
      });
    }
  }

  const totals = allResults.reduce(
    (acc, r) => ({
      accepted: acc.accepted + r.accepted,
      rejected: acc.rejected + r.rejected,
      inconclusive: acc.inconclusive + r.inconclusive,
    }),
    { accepted: 0, rejected: 0, inconclusive: 0 },
  );

  console.log(`\n--- Totals across ${patientIds.length} patients ---`);
  console.log(totals);
}

main().catch((err) => {
  console.error("ERE batch run failed:", err);
  process.exit(1);
});
