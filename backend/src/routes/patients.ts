import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";

export const patientsRouter = Router();

// GET /patients — list all patients, with a quick event count for each
patientsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await withSession((session) =>
      session.run(
        `
        MATCH (p:Patient)
        OPTIONAL MATCH (p)-[:HAS_EVENT]->(e)
        RETURN p.id AS id, count(e) AS eventCount
        ORDER BY p.id
        `,
      ),
    );

    const patients = result.records.map((record) => ({
      id: record.get("id"),
      eventCount: record.get("eventCount").toNumber(), // Neo4j returns Integer objects
    }));

    return res.json({ patients });
  } catch (err) {
    console.error("Failed to fetch patients:", err);
    return res.status(500).json({ error: "Failed to fetch patients" });
  }
});

// POST /patients — create a new empty patient record
patientsRouter.post("/", async (req: Request, res: Response) => {
  const { id } = req.body;

  if (!id || typeof id !== "string" || id.trim() === "") {
    return res.status(400).json({ error: "Patient id is required" });
  }

  try {
    await withSession((session) =>
      session.run(`MERGE (p:Patient {id: $id}) RETURN p`, { id: id.trim() }),
    );

    return res.status(201).json({ id: id.trim() });
  } catch (err) {
    console.error("Failed to create patient:", err);
    return res.status(500).json({ error: "Failed to create patient" });
  }
});

// PATCH /patients/:id — rename a patient's id (also updates patientId on all their events)
patientsRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newId } = req.body;

  if (!newId || typeof newId !== "string" || newId.trim() === "") {
    return res.status(400).json({ error: "newId is required" });
  }

  const trimmedNewId = newId.trim();

  if (trimmedNewId === id) {
    return res.json({ id });
  }

  try {
    const existing = await withSession((session) =>
      session.run(`MATCH (p:Patient {id: $newId}) RETURN p`, {
        newId: trimmedNewId,
      }),
    );
    if (existing.records.length > 0) {
      return res
        .status(409)
        .json({ error: `Patient ${trimmedNewId} already exists` });
    }

    const result = await withSession((session) =>
      session.run(
        `
        MATCH (p:Patient {id: $id})
        SET p.id = $newId
        WITH p
        OPTIONAL MATCH (p)-[:HAS_EVENT]->(e)
        SET e.patientId = $newId
        RETURN p.id AS id
        `,
        { id, newId: trimmedNewId },
      ),
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: `Patient ${id} not found` });
    }

    return res.json({ id: result.records[0].get("id") });
  } catch (err) {
    console.error("Failed to rename patient:", err);
    return res.status(500).json({ error: "Failed to rename patient" });
  }
});

// DELETE /patients/:id — remove a patient and all their events
patientsRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const check = await withSession((session) =>
      session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
    );
    if (check.records.length === 0) {
      return res.status(404).json({ error: `Patient ${id} not found` });
    }

    await withSession((session) =>
      session.run(
        `
        MATCH (p:Patient {id: $id})
        OPTIONAL MATCH (p)-[:HAS_EVENT]->(e)
        WITH p, collect(e) AS events
        FOREACH (ev IN events | DETACH DELETE ev)
        DETACH DELETE p
        `,
        { id },
      ),
    );

    return res.json({ message: `Patient ${id} deleted` });
  } catch (err) {
    console.error("Failed to delete patient:", err);
    return res.status(500).json({ error: "Failed to delete patient" });
  }
});
