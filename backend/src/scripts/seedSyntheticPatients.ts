import fs from "fs";
import path from "path";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const SEED_FILE = path.join(__dirname, "seedData", "syntheticPatients.json");

/**
 * One-time (or repeatable) seed script — posts the flattened synthetic
 * event array to the existing POST /events/bulk endpoint. Nothing new is
 * built here; this is purely a client of the M1 ingestion API that
 * already exists, same as any other caller of /events/bulk would be.
 *
 * Run with: npx ts-node src/scripts/seedSyntheticPatients.ts
 */
async function main() {
  const raw = fs.readFileSync(SEED_FILE, "utf-8");
  const events = JSON.parse(raw);

  if (!Array.isArray(events)) {
    throw new Error("syntheticPatients.json must contain a JSON array");
  }

  console.log(`Seeding ${events.length} events from ${SEED_FILE}...`);

  const res = await fetch(`${BACKEND_URL}/events/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
  });

  const body = (await res.json()) as any;

  if (res.status !== 207 && !res.ok) {
    console.error("Seed request failed:", body);
    process.exit(1);
  }

  console.log(`\n${body.message}`);
  console.log(`Import batch ID: ${body.importBatchId}`);
  console.log(`Created: ${body.createdCount}, Failed: ${body.failedCount}`);

  if (body.failedCount > 0) {
    console.log("\nFailures:");
    console.log(
      body.results.filter((r: { status: string }) => r.status === "failed"),
    );
  }

  console.log(
    `\nTo remove this synthetic dataset later:\n` +
      `  DELETE ${BACKEND_URL}/events/batch/${body.importBatchId}`,
  );
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
