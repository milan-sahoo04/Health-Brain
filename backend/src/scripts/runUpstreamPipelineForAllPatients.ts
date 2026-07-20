const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

/**
 * Backfills /synthesize (legacy Pattern) and /patterns/gnn (PatternCandidate)
 * for every patient, so M5.6 validation has real upstream data to reason
 * over. Dev/validation script only — same reasoning as runEreForAllPatients.ts.
 */
async function main() {
  const patientsRes = await fetch(`${BACKEND_URL}/patients`);
  const { patients } = (await patientsRes.json()) as {
    patients: { id: string }[];
  };

  console.log(
    `Backfilling upstream pipeline for ${patients.length} patients...\n`,
  );

  for (const { id } of patients) {
    try {
      await fetch(`${BACKEND_URL}/events/${id}/synthesize`, { method: "POST" });
      console.log(`  ${id}: /synthesize done`);
    } catch (err) {
      console.error(`  ${id}: /synthesize FAILED`, err);
    }
    try {
      await fetch(`${BACKEND_URL}/patients/${id}/patterns/gnn`, {
        method: "POST",
      });
      console.log(`  ${id}: /patterns/gnn done`);
    } catch (err) {
      console.error(`  ${id}: /patterns/gnn FAILED`, err);
    }
  }

  console.log(
    "\nBackfill complete. Now run runEreForAllPatients.ts for real M5.6 validation.",
  );
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
