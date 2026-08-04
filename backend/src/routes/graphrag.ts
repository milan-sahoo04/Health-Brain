import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import { expandFromSections } from "../services/graphrag/graph/graphTraverser";
import { retrieveCandidates } from "../services/graphrag/retrievers/vectorRetriever";
import { rankKnowledge } from "../services/graphrag/ranking/hybridRanker";
import { buildRetrievalContext } from "../services/graphrag/builders/contextBuilder";
import { buildPrompt } from "../services/graphrag/builders/promptBuilder";
import { runGraphRAGRetrieval } from "../services/graphrag/orchestrator";

export const graphragRouter = Router();

// GET /patients/:id/graphrag/traverse-preview?sectionIds=id1,id2,...
// DEBUG endpoint for M9.2. Validates expandFromSections() against real
// data without any vector search involved — sectionIds passed directly.
graphragRouter.get(
  "/:id/graphrag/traverse-preview",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const sectionIdsParam = req.query.sectionIds;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof sectionIdsParam !== "string" || sectionIdsParam.trim() === "") {
      return res.status(400).json({
        error: "Query param 'sectionIds' is required (comma-separated)",
      });
    }

    const sectionIds = sectionIdsParam.split(",").map((s) => s.trim());

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const results = await withSession((session) =>
        expandFromSections(session, id, sectionIds),
      );

      return res.json({
        patientId: id,
        requestedSectionIds: sectionIds,
        resultCount: results.length,
        results,
      });
    } catch (err) {
      console.error("Failed traverse-preview:", err);
      return res.status(500).json({ error: "Failed to traverse graph" });
    }
  },
);

// GET /patients/:id/graphrag/vector-preview?query=...&topK=5
// DEBUG endpoint for M9.3. Validates retrieveCandidates() directly.
graphragRouter.get(
  "/:id/graphrag/vector-preview",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const query = req.query.query;
    const topK = req.query.topK ? Number(req.query.topK) : undefined;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "Query param 'query' is required" });
    }

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const hits = await retrieveCandidates(query, id, topK);

      return res.json({
        patientId: id,
        query,
        topK: topK ?? 5,
        resultCount: hits.length,
        results: hits,
      });
    } catch (err) {
      console.error("Failed vector-preview:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Failed vector search",
      });
    }
  },
);

// GET /patients/:id/graphrag/rank-preview?query=...&topK=5
// DEBUG endpoint for M9.4. Chains VectorRetriever -> GraphTraverser ->
// HybridRanker end-to-end, no ContextBuilder/prompt logic yet.
graphragRouter.get(
  "/:id/graphrag/rank-preview",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const query = req.query.query;
    const topK = req.query.topK ? Number(req.query.topK) : undefined;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "Query param 'query' is required" });
    }

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const hits = await retrieveCandidates(query, id, topK);
      const sectionIds = hits.map((h) => h.sectionId);
      const retrieved = await withSession((session) =>
        expandFromSections(session, id, sectionIds),
      );
      const ranked = rankKnowledge(retrieved, hits);

      return res.json({
        patientId: id,
        query,
        vectorHitCount: hits.length,
        graphExpandedCount: retrieved.length,
        rankingStatus: ranked.status,
        results: ranked.results,
      });
    } catch (err) {
      console.error("Failed rank-preview:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Failed ranking",
      });
    }
  },
);

// GET /patients/:id/graphrag/context-preview?query=...&topK=5&budget=8000
// DEBUG endpoint for M9.5. Full pipeline: VectorRetriever -> GraphTraverser
// -> HybridRanker -> ContextBuilder.
graphragRouter.get(
  "/:id/graphrag/context-preview",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const query = req.query.query;
    const topK = req.query.topK ? Number(req.query.topK) : undefined;
    const budget = req.query.budget ? Number(req.query.budget) : undefined;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "Query param 'query' is required" });
    }

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const startTime = Date.now();
      const hits = await retrieveCandidates(query, id, topK);
      const sectionIds = hits.map((h) => h.sectionId);
      const retrieved = await withSession((session) =>
        expandFromSections(session, id, sectionIds),
      );
      const ranked = rankKnowledge(retrieved, hits);
      const retrievalTimeMs = Date.now() - startTime;

      const context = buildRetrievalContext(
        query,
        id,
        ranked,
        hits,
        retrieved.length,
        retrievalTimeMs,
        budget,
      );

      return res.json(context);
    } catch (err) {
      console.error("Failed context-preview:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Failed context build",
      });
    }
  },
);

// GET /patients/:id/graphrag/prompt-preview?query=...&topK=5&budget=8000&maxTokens=4000
// DEBUG endpoint for M9.6. Full pipeline through PromptPayload.
graphragRouter.get(
  "/:id/graphrag/prompt-preview",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const query = req.query.query;
    const topK = req.query.topK ? Number(req.query.topK) : undefined;
    const budget = req.query.budget ? Number(req.query.budget) : undefined;
    const maxTokens = req.query.maxTokens
      ? Number(req.query.maxTokens)
      : undefined;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "Query param 'query' is required" });
    }

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const startTime = Date.now();
      const hits = await retrieveCandidates(query, id, topK);
      const sectionIds = hits.map((h) => h.sectionId);
      const retrieved = await withSession((session) =>
        expandFromSections(session, id, sectionIds),
      );
      const ranked = rankKnowledge(retrieved, hits);
      const retrievalTimeMs = Date.now() - startTime;

      const context = buildRetrievalContext(
        query,
        id,
        ranked,
        hits,
        retrieved.length,
        retrievalTimeMs,
        budget,
      );
      const prompt = buildPrompt(context, undefined, maxTokens);

      return res.json(prompt);
    } catch (err) {
      console.error("Failed prompt-preview:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Failed prompt build",
      });
    }
  },
);

// POST /patients/:id/graphrag/retrieve — PRODUCTION entrypoint.
// Wires the complete M9.1-M9.7 pipeline. Returns RetrievalContext,
// PromptPayload, and retrieval metadata ONLY — never a generated
// medical answer. The stub adapter's ReasoningResult explicitly
// carries no "answer" field, enforcing this at the type level as well
// as by convention.
graphragRouter.post(
  "/:id/graphrag/retrieve",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { question, topK, contextCharacterBudget, maxPromptTokens } =
      req.body;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof question !== "string" || question.trim() === "") {
      return res
        .status(400)
        .json({ error: "'question' is required in the request body" });
    }

    try {
      const check = await withSession((session) =>
        session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
      );
      if (check.records.length === 0) {
        return res.status(404).json({ error: `Patient ${id} not found` });
      }

      const result = await withSession((session) =>
        runGraphRAGRetrieval(session, id, question, {
          topK,
          contextCharacterBudget,
          maxPromptTokens,
        }),
      );

      return res.json(result);
    } catch (err) {
      console.error("Failed graphrag/retrieve:", err);
      return res.status(503).json({
        error: err instanceof Error ? err.message : "Failed retrieval pipeline",
      });
    }
  },
);
