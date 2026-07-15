import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import { previewPromotion } from "../services/knowledge/knowledgePromoter";
import { promoteCandidate } from "../services/knowledge/knowledgePromoter";
import { makeAcceptedCandidateFixture } from "../services/knowledge/__fixtures__/knowledgeCandidateFixtures";

export const knowledgeRouter = Router();

// GET /patients/:id/knowledge/preview — DEBUG endpoint for M6.1 only.
// Shows what Knowledge nodes WOULD be created from accepted
// KnowledgeCandidates, without writing anything. Validates the
// deterministic id scheme against real data.
knowledgeRouter.get(
  "/:id/knowledge/preview",
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

      const previews = await withSession((session) =>
        previewPromotion(session, id),
      );

      return res.json({
        patientId: id,
        acceptedCandidateCount: previews.length,
        wouldCreateCount: previews.filter((p) => p.wouldCreateNew).length,
        previews,
      });
    } catch (err) {
      console.error("Failed to preview promotion:", err);
      return res.status(500).json({ error: "Failed to preview promotion" });
    }
  },
);

// POST /patients/:id/knowledge/test-promotion — DEBUG/TEST endpoint for
// M6.2 ONLY. Uses a fixture (not live threshold changes) to validate
// promoteCandidate() end-to-end, then deletes what it created. Requires
// a REAL :KnowledgeCandidate to exist for this patient (any status) so
// PROMOTED_FROM/SUPPORTED_BY have something real to link to — the fixture
// only fakes the "accepted" status and confidence numbers, not the whole
// graph structure.
knowledgeRouter.post(
  "/:id/knowledge/test-promotion",
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    try {
      const anyCandidateResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate) RETURN elementId(kc) AS id LIMIT 1`,
          { id },
        ),
      );
      if (anyCandidateResult.records.length === 0) {
        return res.status(400).json({
          error: `No KnowledgeCandidate exists for patient ${id} to anchor the test fixture to. Run /evidence/evaluate first.`,
        });
      }
      const candidateElementId = anyCandidateResult.records[0].get(
        "id",
      ) as string;

      const fixture = makeAcceptedCandidateFixture({
        patientId: id,
        candidateElementId,
      });

      const result = await withSession((session) =>
        promoteCandidate(session, fixture),
      );

      // Clean up immediately — this is a TEST fixture, not real promoted knowledge.
      await withSession((session) =>
        session.run(
          `MATCH (k:Knowledge {id: $knowledgeId}) OPTIONAL MATCH (k)-[:HAS_VERSION]->(v) DETACH DELETE k, v`,
          { knowledgeId: result.knowledgeId },
        ),
      );

      return res.json({
        message: "M6.2 fixture-based promotion test PASSED and was cleaned up.",
        testedKnowledgeId: result.knowledgeId,
      });
    } catch (err) {
      console.error("M6.2 promotion test failed:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Promotion test failed",
      });
    }
  },
);
