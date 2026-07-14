import { exportAllPatientGraphs } from "../services/graphExportService";
import { triggerTraining } from "../services/gnnTrainingClient";

async function main() {
  console.log("Exporting all patient graphs...");
  const batches = await exportAllPatientGraphs();
  console.log(`Exported ${batches.length} patients with events.`);

  if (batches.length === 0) {
    console.error("No patients with events found — seed data before training.");
    process.exit(1);
  }

  console.log("Sending to gnn-service for training...");
  const result = await triggerTraining(batches);

  console.log("\nTraining complete:");
  console.log(result);
}

main().catch((err) => {
  console.error("Training run failed:", err);
  process.exit(1);
});
