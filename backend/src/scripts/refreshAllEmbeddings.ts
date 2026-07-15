export {};
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

/**
 * Loops the existing POST /patients/:id/embeddings/refresh (M3) across
 * every synthetic patient created by seedSyntheticPatients.ts. M3's
 * endpoint is deliberately per-patient (see the M3 design notes), so
 * batch-refreshing many patients means calling it many times — this
 * script does exactly that, sequentially, so gnn-service /train (M4.3)
 * has real embeddings on every node instead of the zero-fill fallback.
 *
 * Run with: npx ts-node src/scripts/refreshAllEmbeddings.ts
 */
const SYNTHETIC_PATIENT_IDS = [
  "synthetic-responder-1",
  "synthetic-responder-2",
  "synthetic-responder-3",
  "synthetic-responder-4",
  "synthetic-responder-5",
  "synthetic-nonresponder-1",
  "synthetic-nonresponder-2",
  "synthetic-nonresponder-3",
  "synthetic-nonresponder-4",
  "synthetic-confounded-1",
  "synthetic-confounded-2",
  "synthetic-confounded-3",
  "synthetic-sparse-1",
  "synthetic-sparse-2",
  "synthetic-sparse-3",
];

async function refreshOne(patientId: string) {
  const res = await fetch(
    `${BACKEND_URL}/patients/${patientId}/embeddings/refresh`,
    { method: "POST" },
  );
  const body = (await res.json()) as any;
  if (!res.ok) {
    console.error(`  FAILED ${patientId}:`, body);
    return { patientId, ok: false };
  }
  console.log(
    `  OK ${patientId}: nodesUpdated=${body.nodesUpdated}, dimensions=${body.dimensions}`,
  );
  return { patientId, ok: true };
}

async function main() {
  console.log(
    `Refreshing embeddings for ${SYNTHETIC_PATIENT_IDS.length} synthetic patients...\n`,
  );

  const results = [];
  for (const patientId of SYNTHETIC_PATIENT_IDS) {
    // Sequential, not Promise.all — avoids hammering the embedding
    // microservice with concurrent requests it wasn't load-tested for.
    results.push(await refreshOne(patientId));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nDone. ${results.length - failed.length}/${results.length} succeeded.`,
  );
  if (failed.length > 0) {
    console.log(
      "Failed patients:",
      failed.map((f) => f.patientId),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Embedding refresh run failed:", err);
  process.exit(1);
});
