import neo4j, { Driver, Session } from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.NEO4J_URI as string;
const username = process.env.NEO4J_USERNAME as string;
const password = process.env.NEO4J_PASSWORD as string;

if (!uri || !username || !password) {
  throw new Error(
    "Missing Neo4j credentials. Check your .env file has NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.",
  );
}

export const driver: Driver = neo4j.driver(
  uri,
  neo4j.auth.basic(username, password),
);

// Call this once at server startup to fail fast if credentials are wrong
export async function verifyConnection(): Promise<void> {
  await driver.verifyConnectivity();
  console.log("✅ Connected to Neo4j Aura");
}

// Helper: opens a session, runs your work, always closes the session after
export async function withSession<T>(
  work: (session: Session) => Promise<T>,
): Promise<T> {
  const session = driver.session();
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}
