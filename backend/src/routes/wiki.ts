import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import {
  computeWikiPageId,
  computeWikiSectionId,
} from "../models/wikiMetadata";
import { WIKI_SECTION_KEYS } from "../models/wiki";
import {
  previewKnowledgeForWiki,
  retrieveWikiData,
} from "../services/wiki/wikiRetriever";
import { buildAllSections } from "../services/wiki/sectionBuilders";
import { generateWiki } from "../services/wiki/wikiGenerator";
import { syncEmbeddings } from "../services/wiki/wikiEmbeddingOrchestrator";

export const wikiRouter = Router();

// GET /patients/:id/wiki/preview — DEBUG endpoint for M7.1.
// Shows the computed WikiPage/WikiSection ids and the real active
// Knowledge that WOULD feed the wiki, without writing anything.
wikiRouter.get("/:id/wiki/preview", async (req: Request, res: Response) => {
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

    const knowledge = await withSession((session) =>
      previewKnowledgeForWiki(session, id),
    );

    const wikiPageId = computeWikiPageId(id);
    const sectionIds = WIKI_SECTION_KEYS.map((key) => ({
      sectionKey: key,
      id: computeWikiSectionId(id, key),
    }));

    return res.json({
      patientId: id,
      computedWikiPageId: wikiPageId,
      computedSectionIds: sectionIds,
      activeKnowledgeCount: knowledge.length,
      knowledge,
    });
  } catch (err) {
    console.error("Failed to preview wiki:", err);
    return res.status(500).json({ error: "Failed to preview wiki" });
  }
});

// GET /patients/:id/wiki/retrieval-preview — DEBUG endpoint for M7.2.
wikiRouter.get(
  "/:id/wiki/retrieval-preview",
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

      const data = await withSession((session) =>
        retrieveWikiData(session, id),
      );

      return res.json({
        patientId: id,
        knowledgeItemCount: data.knowledgeItems.length,
        totalEvidenceCount: data.knowledgeItems.reduce(
          (sum, k) => sum + k.evidence.length,
          0,
        ),
        knowledgeItems: data.knowledgeItems,
      });
    } catch (err) {
      console.error("Failed to retrieve wiki data:", err);
      return res.status(500).json({ error: "Failed to retrieve wiki data" });
    }
  },
);

// GET /patients/:id/wiki/sections-preview — DEBUG endpoint for M7.3.
// Runs all 9 section builders against REAL retrieved data (no fixtures
// needed — pattern-demo-1 now has genuine active Knowledge). No writes.
wikiRouter.get(
  "/:id/wiki/sections-preview",
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

      const data = await withSession((session) =>
        retrieveWikiData(session, id),
      );
      const sections = buildAllSections(data);

      return res.json({
        patientId: id,
        sectionCount: sections.length,
        sections,
      });
    } catch (err) {
      console.error("Failed to build wiki sections:", err);
      return res.status(500).json({ error: "Failed to build wiki sections" });
    }
  },
);

// POST /patients/:id/wiki/regenerate — PRODUCTION entrypoint.
wikiRouter.post("/:id/wiki/regenerate", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (typeof id !== "string" || id.trim() === "")
    return res.status(400).json({ error: "Patient id is required" });

  try {
    const check = await withSession((session) =>
      session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
    );
    if (check.records.length === 0)
      return res.status(404).json({ error: `Patient ${id} not found` });

    const wikiResult = await withSession((session) =>
      generateWiki(session, id),
    );
    const embeddingResult = await withSession((session) =>
      syncEmbeddings(session, id, wikiResult),
    );

    return res.json({
      message: `Wiki ${wikiResult.action} for patient ${id}`,
      wiki: wikiResult,
      embeddings: embeddingResult,
    });
  } catch (err) {
    console.error("Failed to generate wiki:", err);
    return res.status(500).json({ error: "Failed to generate wiki" });
  }
});

// GET /patients/:id/wiki — PRODUCTION read.
wikiRouter.get("/:id/wiki", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (typeof id !== "string" || id.trim() === "")
    return res.status(400).json({ error: "Patient id is required" });

  try {
    const result = await withSession((session) =>
      session.run(
        `MATCH (p:Patient {id: $id})-[:HAS_WIKI]->(w:WikiPage) OPTIONAL MATCH (w)-[:HAS_SECTION]->(s:WikiSection)
         RETURN w, collect(s) AS sections`,
        { id },
      ),
    );
    if (result.records.length === 0)
      return res.status(404).json({
        error: `No wiki found for patient ${id}. Call /regenerate first.`,
      });

    const w = result.records[0].get("w").properties;
    const sections = result.records[0]
      .get("sections")
      .map((s: any) => s.properties)
      .sort((a: any, b: any) => a.sectionOrder - b.sectionOrder);
    return res.json({ patientId: id, wikiPage: w, sections });
  } catch (err) {
    console.error("Failed to fetch wiki:", err);
    return res.status(500).json({ error: "Failed to fetch wiki" });
  }
});
