import { withSession } from "../db/neo4j";
import { generateWiki } from "../services/wiki/wikiGenerator";

async function main() {
  const patientIds = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (p:Patient) RETURN p.id AS id ORDER BY p.id`,
    );
    return result.records.map((r) => r.get("id") as string);
  });

  console.log(
    `Running M7 wiki generation for ${patientIds.length} patients...\n`,
  );

  const startAll = Date.now();
  let created = 0,
    updated = 0,
    unchanged = 0,
    failed = 0;

  for (const patientId of patientIds) {
    try {
      const start = Date.now();
      const result = await withSession((session) =>
        generateWiki(session, patientId),
      );
      const ms = Date.now() - start;
      console.log(
        `${patientId}: ${result.action} (v${result.versionNumber}, ${result.changedSections.length} sections changed, ${ms}ms)`,
      );
      if (result.action === "created") created++;
      else if (result.action === "updated") updated++;
      else unchanged++;
    } catch (err) {
      console.error(
        `  FAILED for ${patientId}:`,
        err instanceof Error ? err.message : err,
      );
      failed++;
    }
  }
  const totalMs = Date.now() - startAll;

  console.log(`\n--- Totals across ${patientIds.length} patients ---`);
  console.log({
    created,
    updated,
    unchanged,
    failed,
    totalMs,
    avgMsPerPatient: (totalMs / patientIds.length).toFixed(1),
  });

  // Idempotency check: re-run immediately, everything should be "unchanged"
  console.log(`\n--- Idempotency re-run (expect ALL unchanged) ---`);
  let unexpectedChange = 0;
  for (const patientId of patientIds) {
    const result = await withSession((session) =>
      generateWiki(session, patientId),
    );
    if (result.action !== "unchanged") {
      console.error(
        `  UNEXPECTED: ${patientId} returned "${result.action}" on immediate re-run`,
      );
      unexpectedChange++;
    }
  }
  console.log(
    unexpectedChange === 0
      ? "Idempotency check PASSED — all patients unchanged on re-run."
      : `Idempotency check FAILED — ${unexpectedChange} patients changed unexpectedly.`,
  );
}

main().catch((err) => {
  console.error("Wiki batch generation failed:", err);
  process.exit(1);
});
