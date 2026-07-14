import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import { refreshPatientEmbeddings } from "../services/embeddingService";

export const embeddingsRouter = Router();

// POST /patients/:id/embeddings/refresh
// Exports the patient's subgraph, calls the embedding microservice,
// writes the resulting vectors back onto the event nodes.
embeddingsRouter.post(
  "/:id/embeddings/refresh",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    try {
      // Existence check first, same pattern as patients.ts DELETE/PATCH —
      // gives a clean 404 instead of surfacing exportPatientGraph's
      // internal "not found" Error through a generic 500.
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const summary = await refreshPatientEmbeddings(id);

      if (summary.nodesUpdated === 0) {
        return res.status(200).json({
          message: `Patient ${id} has no events yet — nothing to embed`,
          ...summary,
        });
      }

      return res.status(200).json({
        message: `Embeddings refreshed for patient ${id}`,
        ...summary,
      });
    } catch (err) {
      console.error("Failed to refresh embeddings:", err);
      return res.status(500).json({ error: "Failed to refresh embeddings" });
    }
  },
);
