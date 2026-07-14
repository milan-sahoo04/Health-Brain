import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import { discoverPatientPatterns } from "../services/gnnPatternService";

export const gnnPatternsRouter = Router();

// POST /patients/:id/patterns/gnn — run GNN inference, persist PatternCandidates
gnnPatternsRouter.post(
  "/:id/patterns/gnn",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const summary = await discoverPatientPatterns(id);
      return res.status(200).json({
        message: `GNN pattern discovery complete for patient ${id}`,
        ...summary,
      });
    } catch (err) {
      console.error("Failed to run GNN pattern discovery:", err);
      if (
        err instanceof Error &&
        err.message.includes("No trained GNN model")
      ) {
        return res.status(503).json({ error: err.message });
      }
      return res
        .status(500)
        .json({ error: "Failed to run GNN pattern discovery" });
    }
  },
);

// GET /patients/:id/patterns/gnn — read back persisted PatternCandidates
gnnPatternsRouter.get(
  "/:id/patterns/gnn",
  async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const result = await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE]->(c:PatternCandidate)
        RETURN c
        ORDER BY c.status DESC, c.confidence DESC
        `,
          { id },
        ),
      );
      const candidates = result.records.map((r) => r.get("c").properties);
      return res.json({
        patientId: id,
        count: candidates.length,
        activeCount: candidates.filter((c) => c.status === "active").length,
        candidates,
      });
    } catch (err) {
      console.error("Failed to fetch GNN candidates:", err);
      return res.status(500).json({ error: "Failed to fetch GNN candidates" });
    }
  },
);
