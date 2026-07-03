import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";
import { verifyConnection } from "./db/neo4j";

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await verifyConnection(); // fails fast if Neo4j credentials are wrong

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
