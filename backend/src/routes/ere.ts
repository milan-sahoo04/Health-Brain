import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import { buildHypothesesForPatient } from "../services/ere/hypothesisFactory";
import { collectEvidenceForHypothesis } from "../services/ere/evidenceCollector";
import { analyzeContradictions } from "../services/ere/contradictionAnalyzer";
import { scoreHypothesis } from "../services/ere/confidenceScorer";
import { runEvidenceReasoningEngine } from "../services/ere/ereOrchestrator";

export const ereRouter = Router();

// GET /patients/:id/hypotheses — DEBUG endpoint for M5.1 only.
// Returns unified hypotheses from both :Pattern and :PatternCandidate,
// no evidence/scoring yet.
ereRouter.get("/:id/hypotheses", async (req: Request, res: Response) => {
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

    const hypotheses = await withSession((session) =>
      buildHypothesesForPatient(session, id),
    );

    const bySource = {
      legacy_correlation: hypotheses.filter(
        (h) => h.sourceType === "legacy_correlation",
      ).length,
      legacy_association: hypotheses.filter(
        (h) => h.sourceType === "legacy_association",
      ).length,
      gnn_candidate: hypotheses.filter((h) => h.sourceType === "gnn_candidate")
        .length,
    };

    return res.json({
      patientId: id,
      count: hypotheses.length,
      bySource,
      hypotheses,
    });
  } catch (err) {
    console.error("Failed to build hypotheses:", err);
    return res.status(500).json({ error: "Failed to build hypotheses" });
  }
});

// --- add this route ---
// GET /patients/:id/evidence — DEBUG endpoint for M5.2 only.
// Builds hypotheses, collects evidence for each, returns evidence +
// contradiction report. No confidence scoring or persistence yet.
ereRouter.get("/:id/evidence", async (req: Request, res: Response) => {
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

    const hypotheses = await withSession((session) =>
      buildHypothesesForPatient(session, id),
    );

    const results = [];
    for (const hypothesis of hypotheses) {
      // Sequential per hypothesis, sequential per-session internally —
      // avoids the exact concurrency bug we hit in M5.1.
      const evidence = await withSession((session) =>
        collectEvidenceForHypothesis(session, hypothesis),
      );
      const contradictionReport = analyzeContradictions(
        hypothesis.id,
        evidence,
      );
      results.push({
        hypothesis,
        evidenceCount: evidence.length,
        evidence,
        contradictionReport,
      });
    }

    return res.json({
      patientId: id,
      hypothesesEvaluated: results.length,
      results,
    });
  } catch (err) {
    console.error("Failed to collect evidence:", err);
    return res.status(500).json({ error: "Failed to collect evidence" });
  }
});

// GET /patients/:id/knowledge-preview — DEBUG endpoint for M5.3.
// Full pipeline through scoring, still no Neo4j writes.
ereRouter.get("/:id/knowledge-preview", async (req: Request, res: Response) => {
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

    const hypotheses = await withSession((session) =>
      buildHypothesesForPatient(session, id),
    );

    const results = [];
    for (const hypothesis of hypotheses) {
      const evidence = await withSession((session) =>
        collectEvidenceForHypothesis(session, hypothesis),
      );
      const contradictionReport = analyzeContradictions(
        hypothesis.id,
        evidence,
      );
      const scored = scoreHypothesis(hypothesis, evidence, contradictionReport);
      results.push({
        hypothesis,
        evidenceCount: evidence.length,
        contradictionReport,
        scored,
      });
    }

    const byStatus = {
      accepted: results.filter((r) => r.scored.status === "accepted").length,
      rejected: results.filter((r) => r.scored.status === "rejected").length,
      inconclusive: results.filter((r) => r.scored.status === "inconclusive")
        .length,
    };

    return res.json({
      patientId: id,
      hypothesesEvaluated: results.length,
      byStatus,
      results,
    });
  } catch (err) {
    console.error("Failed to preview knowledge candidates:", err);
    return res
      .status(500)
      .json({ error: "Failed to preview knowledge candidates" });
  }
});

// POST /patients/:id/evidence/evaluate — full M5 pipeline, persists KnowledgeCandidates.
ereRouter.post(
  "/:id/evidence/evaluate",
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

      const summary = await runEvidenceReasoningEngine(id);
      return res.status(200).json({
        message: `Evidence reasoning complete for patient ${id}`,
        ...summary,
      });
    } catch (err) {
      console.error("Failed to run evidence reasoning engine:", err);
      return res
        .status(500)
        .json({ error: "Failed to run evidence reasoning engine" });
    }
  },
);

// GET /patients/:id/knowledge-candidates — read back persisted KnowledgeCandidates.
ereRouter.get(
  "/:id/knowledge-candidates",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const result = await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate)
        RETURN kc
        ORDER BY kc.status DESC, kc.finalConfidence DESC
        `,
          { id },
        ),
      );
      const candidates = result.records.map((r) => r.get("kc").properties);
      return res.json({
        patientId: id,
        count: candidates.length,
        acceptedCount: candidates.filter((c) => c.status === "accepted").length,
        candidates,
      });
    } catch (err) {
      console.error("Failed to fetch knowledge candidates:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch knowledge candidates" });
    }
  },
);
