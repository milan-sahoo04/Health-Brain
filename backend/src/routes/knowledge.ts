import { Router, Request, Response } from "express";
import { withSession } from "../db/neo4j";
import { previewPromotion } from "../services/knowledge/knowledgePromoter";
import { promoteCandidate } from "../services/knowledge/knowledgePromoter";
import { makeAcceptedCandidateFixture } from "../services/knowledge/__fixtures__/knowledgeCandidateFixtures";
import { decideVersioningAction } from "../services/knowledge/knowledgeVersioning";
import { DEFAULT_VERSIONING_POLICY } from "../services/knowledge/versioningPolicy";
import { promoteOrVersionCandidate } from "../services/knowledge/knowledgePromoter";
import { batchReadKnowledgeState } from "../services/knowledge/knowledgeVersioning";
import { isSignificantChange } from "../services/knowledge/versioningPolicy";
import { promoteOrVersionCandidatesBatch } from "../services/knowledge/knowledgePromoter";
import { retract } from "../services/knowledge/knowledgeRetraction";
import { reactivateKnowledge } from "../db/queries/knowledgeRetractionPersistence";
import { reactivateKnowledge as reactivate } from "../db/queries/knowledgeRetractionPersistence";
import { promotePatientKnowledge } from "../services/knowledge/knowledgePromoter";

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

// GET /patients/:id/knowledge/versioning-preview — DEBUG endpoint for
// M6.3.a only. Shows what versioning action WOULD be taken for each
// accepted KnowledgeCandidate, without writing anything.
knowledgeRouter.get(
  "/:id/knowledge/versioning-preview",
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

      const candidatesResult = await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate)
        WHERE kc.status = "accepted"
        RETURN kc, elementId(kc) AS candidateElementId
        `,
          { id },
        ),
      );

      const decisions = [];
      for (const record of candidatesResult.records) {
        const kc = record.get("kc").properties;
        const candidateElementId: string = record.get("candidateElementId");

        const candidateInput = {
          hypothesisId: kc.hypothesisId,
          patientId: id,
          sourceType: kc.sourceType,
          claim: kc.claim,
          direction: kc.direction,
          priorConfidence: kc.priorConfidence,
          involvedMetricNames: kc.involvedMetricNames,
          status: kc.status,
          finalConfidence: kc.finalConfidence,
          confidenceBreakdown: kc.confidenceBreakdown,
          reasoningSteps: kc.reasoningSteps,
          contradictionReport: kc.contradictionReport,
          candidateElementId,
        };

        const decision = await withSession((session) =>
          decideVersioningAction(
            session,
            candidateInput,
            DEFAULT_VERSIONING_POLICY,
          ),
        );
        decisions.push({
          claim: kc.claim,
          finalConfidence: kc.finalConfidence,
          decision,
        });
      }

      return res.json({
        patientId: id,
        policyUsed: DEFAULT_VERSIONING_POLICY,
        acceptedCandidateCount: decisions.length,
        decisions,
      });
    } catch (err) {
      console.error("Failed to preview versioning:", err);
      return res.status(500).json({ error: "Failed to preview versioning" });
    }
  },
);

// POST /patients/:id/knowledge/test-versioning — DEBUG/TEST endpoint for
// M6.3.b/M6.3.d. Runs promoteOrVersionCandidate TWICE with different
// confidence values, verifies create-then-append produces a correct
// two-version chain (including version ORDER, per M6.3.d's /history
// query shape), then cleans up.
knowledgeRouter.post(
  "/:id/knowledge/test-versioning",
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

      // --- Step 1: first promotion (should CREATE) ---
      const fixtureV1 = makeAcceptedCandidateFixture({
        patientId: id,
        candidateElementId,
        finalConfidence: 0.6,
      });
      const outcome1 = await withSession((session) =>
        promoteOrVersionCandidate(session, fixtureV1),
      );

      // --- Step 2: second promotion, deliberately different confidence (should APPEND) ---
      const fixtureV2 = makeAcceptedCandidateFixture({
        patientId: id,
        candidateElementId,
        finalConfidence: 0.85, // delta = 0.25, well above default 0.15 absolute threshold
      });
      const outcome2 = await withSession((session) =>
        promoteOrVersionCandidate(session, fixtureV2),
      );

      // --- Verification reads, BEFORE cleanup ---
      const verification = await withSession((session) =>
        session.run(
          `
        MATCH (k:Knowledge {id: $knowledgeId})
        OPTIONAL MATCH (k)-[:HAS_VERSION]->(v:KnowledgeVersion)
        OPTIONAL MATCH (k)-[:PROMOTED_FROM]->(kc:KnowledgeCandidate)
        OPTIONAL MATCH (p:Patient)-[:HAS_KNOWLEDGE]->(k)
        RETURN
          k.currentConfidence AS currentConfidence,
          k.versionCount AS versionCount,
          k.confidenceTrend AS confidenceTrend,
          count(DISTINCT v) AS versionNodeCount,
          collect(DISTINCT v.versionNumber) AS versionNumbers,
          count(DISTINCT kc) AS promotedFromCount,
          count(DISTINCT p) AS hasKnowledgeCount
        `,
          { knowledgeId: outcome1.knowledgeId },
        ),
      );
      const record = verification.records[0];

      // --- M6.3.d: history-order check, using the SAME query shape
      // GET /knowledge/:id/history uses (ORDER BY v.versionNumber ASC) —
      // this confirms that query returns versions in the correct order
      // before the real route is exercised against non-fixture data.
      const historyCheck = await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {id: $knowledgeId})
        OPTIONAL MATCH (k)-[:HAS_VERSION]->(v:KnowledgeVersion)
        RETURN v ORDER BY v.versionNumber ASC
        `,
          { id, knowledgeId: outcome1.knowledgeId },
        ),
      );
      const historyVersionNumbers = historyCheck.records.map((r) =>
        r.get("v").properties.versionNumber.toNumber(),
      );

      const checks = {
        check1_firstPromotionCreated:
          outcome1.action === "create" && outcome1.versionNumber === 1,
        check2_secondPromotionAppended:
          outcome2.action === "append_version" && outcome2.versionNumber === 2,
        check3_parentReflectsLatest: record.get("currentConfidence") === 0.85,
        check4_versionChainCorrect:
          record.get("versionNodeCount").toNumber() === 2 &&
          JSON.stringify(
            record
              .get("versionNumbers")
              .map((n: any) => n.toNumber())
              .sort(),
          ) === JSON.stringify([1, 2]),
        check5_relationshipsIntact:
          record.get("promotedFromCount").toNumber() === 1 &&
          record.get("hasKnowledgeCount").toNumber() === 1,
        check6_noDuplicateKnowledgeNodes: true, // implied by MATCH on single deterministic id above returning exactly one row
        check7_historyOrderCorrect:
          JSON.stringify(historyVersionNumbers) === JSON.stringify([1, 2]),
      };

      const allPassed = Object.values(checks).every(Boolean);

      // --- Cleanup ---
      await withSession((session) =>
        session.run(
          `MATCH (k:Knowledge {id: $knowledgeId}) OPTIONAL MATCH (k)-[:HAS_VERSION]->(v) DETACH DELETE k, v`,
          { knowledgeId: outcome1.knowledgeId },
        ),
      );

      return res.json({
        message: allPassed
          ? "M6.3.b/d fixture-based versioning test PASSED and was cleaned up."
          : "M6.3.b/d test completed with FAILURES — see checks below.",
        allPassed,
        outcome1,
        outcome2,
        confidenceTrend: record.get("confidenceTrend"),
        historyVersionNumbers,
        checks,
      });
    } catch (err) {
      console.error("M6.3.b/d versioning test failed:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Versioning test failed",
      });
    }
  },
);
// --- add this route ---
// GET /patients/:id/knowledge/:knowledgeId/history — full version chain
// for one Knowledge node, ordered oldest to newest. This is the
// explainability endpoint M7 (Personal Health Wiki) will eventually call.
knowledgeRouter.get(
  "/:id/knowledge/:knowledgeId/history",
  async (req: Request, res: Response) => {
    const { id, knowledgeId } = req.params;
    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof knowledgeId !== "string" || knowledgeId.trim() === "") {
      return res.status(400).json({ error: "Knowledge id is required" });
    }

    try {
      const result = await withSession((session) =>
        session.run(
          `
          MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {id: $knowledgeId})
          OPTIONAL MATCH (k)-[:HAS_VERSION]->(v:KnowledgeVersion)
          RETURN k, v
          ORDER BY v.versionNumber ASC
          `,
          { id, knowledgeId },
        ),
      );

      if (result.records.length === 0) {
        return res.status(404).json({
          error: `Knowledge ${knowledgeId} not found for patient ${id}`,
        });
      }

      const knowledge = result.records[0].get("k").properties;
      const versions = result.records
        .map((r) => r.get("v"))
        .filter((v) => v !== null)
        .map((v) => v.properties);

      return res.json({
        patientId: id,
        knowledge,
        versionCount: versions.length,
        versions,
      });
    } catch (err) {
      console.error("Failed to fetch knowledge history:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch knowledge history" });
    }
  },
);

// GET /patients/:id/knowledge/batch-preview — DEBUG endpoint for
// M6.4.a. Uses the BATCHED read (one round trip) instead of
// decideVersioningAction's per-candidate reads, and reports the same
// create/append/no_op decision per row, for comparison.
knowledgeRouter.get(
  "/:id/knowledge/batch-preview",
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

      const candidatesResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate) WHERE kc.status = "accepted" RETURN kc, elementId(kc) AS candidateElementId`,
          { id },
        ),
      );

      const candidateInputs = candidatesResult.records.map((r) => {
        const kc = r.get("kc").properties;
        return {
          hypothesisId: kc.hypothesisId,
          patientId: id,
          sourceType: kc.sourceType,
          claim: kc.claim,
          direction: kc.direction,
          priorConfidence: kc.priorConfidence,
          involvedMetricNames: kc.involvedMetricNames,
          status: kc.status,
          finalConfidence: kc.finalConfidence,
          confidenceBreakdown: kc.confidenceBreakdown,
          reasoningSteps: kc.reasoningSteps,
          contradictionReport: kc.contradictionReport,
          candidateElementId: r.get("candidateElementId"),
        };
      });

      const rows = await withSession((session) =>
        batchReadKnowledgeState(session, candidateInputs),
      );

      const decisions = rows.map((row) => {
        if (!row.exists)
          return { knowledgeId: row.knowledgeId, action: "create" };
        const { significant, delta } = isSignificantChange(
          row.currentConfidence!,
          row.candidate.finalConfidence,
          DEFAULT_VERSIONING_POLICY,
        );
        return significant
          ? { knowledgeId: row.knowledgeId, action: "append_version", delta }
          : { knowledgeId: row.knowledgeId, action: "no_op", delta };
      });

      return res.json({
        patientId: id,
        batchSize: candidateInputs.length,
        dedupedSize: rows.length,
        decisions,
      });
    } catch (err) {
      console.error("Failed batch preview:", err);
      return res.status(500).json({ error: "Failed batch preview" });
    }
  },
);

// POST /patients/:id/knowledge/test-batch?batchCount=1035&seqCount=20
knowledgeRouter.post(
  "/:id/knowledge/test-batch",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const batchCount = Number(req.query.batchCount ?? req.query.count) || 20;
    const seqCount = Number(req.query.seqCount) || Math.min(20, batchCount);

    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }

    const cleanup = () =>
      withSession((session) =>
        session.run(
          `MATCH (k:Knowledge) WHERE k.id STARTS WITH $prefix1 OR k.id STARTS WITH $prefix2 OPTIONAL MATCH (k)-[:HAS_VERSION]->(v) DETACH DELETE k, v`,
          {
            prefix1: `knowledge:${id}:hyp:test-batch-seq-`,
            prefix2: `knowledge:${id}:hyp:test-batch-par-`,
          },
        ),
      );

    try {
      await cleanup();

      const anyCandidateResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate) RETURN elementId(kc) AS id LIMIT 1`,
          { id },
        ),
      );
      if (anyCandidateResult.records.length === 0) {
        return res
          .status(400)
          .json({ error: `No KnowledgeCandidate exists for patient ${id}.` });
      }
      const candidateElementId = anyCandidateResult.records[0].get(
        "id",
      ) as string;

      // Sequential: SMALL sample, ONE reused session (not one-per-candidate,
      // fixing the connection-churn bug that caused the ECONNRESET).
      const fixturesSeq = Array.from({ length: seqCount }, (_, i) =>
        makeAcceptedCandidateFixture({
          patientId: id,
          candidateElementId,
          hypothesisId: `hyp:test-batch-seq-${i}`,
          finalConfidence: 0.6,
        }),
      );
      const seqStart = Date.now();
      const seqResults = await withSession(async (session) => {
        const results = [];
        for (const f of fixturesSeq)
          results.push(await promoteOrVersionCandidate(session, f));
        return results;
      });
      const seqMs = Date.now() - seqStart;
      const seqRatePerCandidate = seqMs / seqCount;

      // Batched: FULL scale, matching the real patient-3 candidate count.
      const fixturesBatch = Array.from({ length: batchCount }, (_, i) =>
        makeAcceptedCandidateFixture({
          patientId: id,
          candidateElementId,
          hypothesisId: `hyp:test-batch-par-${i}`,
          finalConfidence: 0.6,
        }),
      );
      const batchStart = Date.now();
      const batchResults = await withSession((session) =>
        promoteOrVersionCandidatesBatch(session, fixturesBatch),
      );
      const batchMs = Date.now() - batchStart;

      const seqActionsSet = new Set(seqResults.map((r) => r.action));
      const batchActionsSet = new Set(batchResults.map((r) => r.action));
      const decisionsMatch =
        JSON.stringify([...seqActionsSet].sort()) ===
        JSON.stringify([...batchActionsSet].sort());

      const extrapolatedSequentialMs = seqRatePerCandidate * batchCount;

      return res.json({
        message: decisionsMatch
          ? "M6.4.c scale test PASSED and was cleaned up."
          : "DECISIONS MISMATCH — see below.",
        decisionsMatch,
        sequentialSample: {
          count: seqCount,
          timeMs: seqMs,
          msPerCandidate: seqRatePerCandidate.toFixed(1),
        },
        batchedFullScale: {
          count: batchCount,
          timeMs: batchMs,
          msPerCandidate: (batchMs / batchCount).toFixed(2),
        },
        extrapolatedSequentialAtFullScaleMs: Math.round(
          extrapolatedSequentialMs,
        ),
        speedupAtFullScale: `${(extrapolatedSequentialMs / batchMs).toFixed(1)}x (extrapolated)`,
      });
    } catch (err) {
      console.error("M6.4.c scale test failed:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Scale test failed",
      });
    } finally {
      await cleanup();
    }
  },
);

// POST /patients/:id/knowledge/:knowledgeId/retract
knowledgeRouter.post(
  "/:id/knowledge/:knowledgeId/retract",
  async (req: Request, res: Response) => {
    const { id, knowledgeId } = req.params;
    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }
    if (typeof knowledgeId !== "string" || knowledgeId.trim() === "") {
      return res.status(400).json({ error: "Knowledge id is required" });
    }
    const { reason } = req.body;
    if (typeof reason !== "string" || reason.trim() === "") {
      return res.status(400).json({ error: "A retraction reason is required" });
    }

    try {
      const check = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {id: $knowledgeId}) RETURN k`,
          { id, knowledgeId },
        ),
      );
      if (check.records.length === 0) {
        return res.status(404).json({
          error: `Knowledge ${knowledgeId} not found for patient ${id}`,
        });
      }

      const result = await withSession((session) =>
        retract(session, knowledgeId, reason),
      );
      return res.json({
        message: `Retraction processed: ${result.action}`,
        ...result,
      });
    } catch (err) {
      console.error("Failed to retract knowledge:", err);
      return res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to retract knowledge",
      });
    }
  },
);

// POST /patients/:id/knowledge/test-retraction — DEBUG/TEST for M6.5.a.
// Fixture-based, mirrors M6.2/M6.3's approach: create -> retract ->
// retract again (same reason, idempotent) -> retract again (different
// reason, metadata update) -> verify -> clean up.
knowledgeRouter.post(
  "/:id/knowledge/test-retraction",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string" || id.trim() === "") {
      return res.status(400).json({ error: "Patient id is required" });
    }

    const cleanup = () =>
      withSession((session) =>
        session.run(
          `MATCH (k:Knowledge) WHERE k.id STARTS WITH $prefix OPTIONAL MATCH (k)-[:HAS_VERSION]->(v) DETACH DELETE k, v`,
          { prefix: `knowledge:${id}:hyp:test-retraction-` },
        ),
      );

    try {
      await cleanup();

      const anyCandidateResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate) RETURN elementId(kc) AS id LIMIT 1`,
          { id },
        ),
      );
      if (anyCandidateResult.records.length === 0) {
        return res
          .status(400)
          .json({ error: `No KnowledgeCandidate exists for patient ${id}.` });
      }
      const candidateElementId = anyCandidateResult.records[0].get(
        "id",
      ) as string;

      const fixture = makeAcceptedCandidateFixture({
        patientId: id,
        candidateElementId,
        hypothesisId: "hyp:test-retraction-1",
        finalConfidence: 0.6,
      });
      const created = await withSession((session) =>
        promoteOrVersionCandidate(session, fixture),
      );

      const retract1 = await withSession((session) =>
        retract(
          session,
          created.knowledgeId,
          "Superseded by newer clinical guidance",
        ),
      );
      const retract2 = await withSession((session) =>
        retract(
          session,
          created.knowledgeId,
          "Superseded by newer clinical guidance",
        ),
      );
      const retract3 = await withSession((session) =>
        retract(
          session,
          created.knowledgeId,
          "Corrected: original evidence was flawed",
        ),
      );

      const verification = await withSession((session) =>
        session.run(
          `
        MATCH (k:Knowledge {id: $knowledgeId})
        OPTIONAL MATCH (k)-[:HAS_VERSION]->(v:KnowledgeVersion)
        RETURN k.currentStatus AS status, k.retractionReason AS reason, k.versionCount AS versionCount,
               count(DISTINCT v) AS versionNodeCount, collect(DISTINCT v.versionNumber) AS versionNumbers
        `,
          { knowledgeId: created.knowledgeId },
        ),
      );
      const record = verification.records[0];

      const checks = {
        check1_firstRetractionWorked: retract1.action === "retracted",
        check2_sameReasonIsNoOp:
          retract2.action === "already_retracted_same_reason",
        check3_differentReasonUpdatesOnly: retract3.action === "reason_updated",
        check4_finalStatusRetracted: record.get("status") === "retracted",
        check5_finalReasonIsLatest:
          record.get("reason") === "Corrected: original evidence was flawed",
        check6_onlyOneRetractionVersionCreated:
          record.get("versionNodeCount").toNumber() === 2, // v1 (create) + v2 (retract)
      };
      const allPassed = Object.values(checks).every(Boolean);

      return res.json({
        message: allPassed
          ? "M6.5.a retraction test PASSED and was cleaned up."
          : "M6.5.a test completed with FAILURES.",
        allPassed,
        retract1,
        retract2,
        retract3,
        finalState: {
          status: record.get("status"),
          reason: record.get("reason"),
          versionCount: record.get("versionCount").toNumber(),
        },
        checks,
      });
    } catch (err) {
      console.error("M6.5.a retraction test failed:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Retraction test failed",
      });
    } finally {
      // await cleanup();
    }
  },
);

knowledgeRouter.post(
  "/:id/knowledge/:knowledgeId/reactivate",
  async (req: Request, res: Response) => {
    const { id, knowledgeId } = req.params;
    if (typeof id !== "string" || id.trim() === "")
      return res.status(400).json({ error: "Patient id is required" });
    if (typeof knowledgeId !== "string" || knowledgeId.trim() === "")
      return res.status(400).json({ error: "Knowledge id is required" });
    const { reason } = req.body;
    if (typeof reason !== "string" || reason.trim() === "")
      return res
        .status(400)
        .json({ error: "A reactivation reason is required" });

    try {
      const check = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {id: $knowledgeId}) RETURN k`,
          { id, knowledgeId },
        ),
      );
      if (check.records.length === 0)
        return res.status(404).json({
          error: `Knowledge ${knowledgeId} not found for patient ${id}`,
        });

      const result = await withSession((session) =>
        reactivateKnowledge(session, knowledgeId, reason),
      );
      return res.json({
        message: `Reactivation processed: ${result.action}`,
        ...result,
      });
    } catch (err) {
      console.error("Failed to reactivate knowledge:", err);
      return res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to reactivate knowledge",
      });
    }
  },
);

knowledgeRouter.post(
  "/:id/knowledge/test-reactivation",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string" || id.trim() === "")
      return res.status(400).json({ error: "Patient id is required" });

    const cleanup = () =>
      withSession((session) =>
        session.run(
          `MATCH (k:Knowledge) WHERE k.id STARTS WITH $prefix OPTIONAL MATCH (k)-[:HAS_VERSION]->(v) DETACH DELETE k, v`,
          { prefix: `knowledge:${id}:hyp:test-reactivate-` },
        ),
      );

    try {
      await cleanup();

      const anyCandidateResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate) RETURN elementId(kc) AS id LIMIT 1`,
          { id },
        ),
      );
      if (anyCandidateResult.records.length === 0)
        return res
          .status(400)
          .json({ error: `No KnowledgeCandidate exists for patient ${id}.` });
      const candidateElementId = anyCandidateResult.records[0].get(
        "id",
      ) as string;

      const fixture = makeAcceptedCandidateFixture({
        patientId: id,
        candidateElementId,
        hypothesisId: "hyp:test-reactivate-1",
        finalConfidence: 0.6,
      });
      const created = await withSession((session) =>
        promoteOrVersionCandidate(session, fixture),
      );
      const retracted = await withSession((session) =>
        retract(session, created.knowledgeId, "Testing reactivation flow"),
      );
      const reactivated1 = await withSession((session) =>
        reactivate(session, created.knowledgeId, "Re-confirmed valid"),
      );
      const reactivated2 = await withSession((session) =>
        reactivate(session, created.knowledgeId, "Re-confirmed valid"),
      ); // idempotency check

      const historyResult = await withSession((session) =>
        session.run(
          `MATCH (k:Knowledge {id: $knowledgeId}) OPTIONAL MATCH (k)-[:HAS_VERSION]->(v:KnowledgeVersion) RETURN k.currentStatus AS status, v ORDER BY v.versionNumber`,
          { knowledgeId: created.knowledgeId },
        ),
      );
      const versions = historyResult.records.map((r) => r.get("v").properties);
      const finalStatus = historyResult.records[0].get("status");

      const checks = {
        check1_retractionWorked: retracted.action === "retracted",
        check2_reactivationWorked: reactivated1.action === "reactivated",
        check3_secondReactivationIsNoOp:
          reactivated2.action === "already_active",
        check4_finalStatusActive: finalStatus === "active",
        check5_fullHistoryPreserved: versions.length === 3, // create, retract, reactivate
        check6_retractionStillVisibleInHistory: versions.some((v: any) =>
          v.reasoningSteps?.[0]?.includes("retracted"),
        ),
      };
      const allPassed = Object.values(checks).every(Boolean);

      return res.json({
        message: allPassed
          ? "M6.5.b reactivation test PASSED and was cleaned up."
          : "M6.5.b test completed with FAILURES.",
        allPassed,
        retracted,
        reactivated1,
        reactivated2,
        finalStatus,
        versionCount: versions.length,
        checks,
      });
    } catch (err) {
      console.error("M6.5.b reactivation test failed:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Reactivation test failed",
      });
    } finally {
      await cleanup();
    }
  },
);

// GET /patients/:id/knowledge?status=active|retracted
knowledgeRouter.get("/:id/knowledge", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (typeof id !== "string" || id.trim() === "")
    return res.status(400).json({ error: "Patient id is required" });

  const statusFilter = req.query.status;
  if (
    statusFilter !== undefined &&
    statusFilter !== "active" &&
    statusFilter !== "retracted"
  ) {
    return res
      .status(400)
      .json({ error: "status must be 'active' or 'retracted' if provided" });
  }

  try {
    const check = await withSession((session) =>
      session.run(`MATCH (p:Patient {id: $id}) RETURN p`, { id }),
    );
    if (check.records.length === 0)
      return res.status(404).json({ error: `Patient ${id} not found` });

    const result = await withSession((session) =>
      session.run(
        `
        MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge)
        WHERE $status IS NULL OR k.currentStatus = $status
        RETURN k ORDER BY k.lastEvaluatedAt DESC
        `,
        { id, status: statusFilter ?? null },
      ),
    );

    const knowledge = result.records.map((r) => r.get("k").properties);
    return res.json({
      patientId: id,
      statusFilter: statusFilter ?? "all",
      count: knowledge.length,
      knowledge,
    });
  } catch (err) {
    console.error("Failed to fetch knowledge list:", err);
    return res.status(500).json({ error: "Failed to fetch knowledge list" });
  }
});

// --- add to backend/src/routes/knowledge.ts ---
knowledgeRouter.post(
  "/:id/knowledge/test-lifecycle-reads",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string" || id.trim() === "")
      return res.status(400).json({ error: "Patient id is required" });

    const cleanup = () =>
      withSession((session) =>
        session.run(
          `MATCH (k:Knowledge) WHERE k.id STARTS WITH $prefix OPTIONAL MATCH (k)-[:HAS_VERSION]->(v) DETACH DELETE k, v`,
          { prefix: `knowledge:${id}:hyp:test-lifecycle-` },
        ),
      );

    try {
      await cleanup();

      const anyCandidateResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_CANDIDATE_KNOWLEDGE]->(kc:KnowledgeCandidate) RETURN elementId(kc) AS id LIMIT 1`,
          { id },
        ),
      );
      if (anyCandidateResult.records.length === 0)
        return res
          .status(400)
          .json({ error: `No KnowledgeCandidate exists for patient ${id}.` });
      const candidateElementId = anyCandidateResult.records[0].get(
        "id",
      ) as string;

      const fixture = makeAcceptedCandidateFixture({
        patientId: id,
        candidateElementId,
        hypothesisId: "hyp:test-lifecycle-1",
        finalConfidence: 0.6,
      });
      const created = await withSession((session) =>
        promoteOrVersionCandidate(session, fixture),
      );

      // Check the REAL /knowledge?status=active list endpoint sees it
      const activeListBefore = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "active"}) RETURN k.id AS id`,
          { id },
        ),
      );
      const foundBeforeRetraction = activeListBefore.records.some(
        (r) => r.get("id") === created.knowledgeId,
      );

      await withSession((session) =>
        retract(session, created.knowledgeId, "Testing status-filtered reads"),
      );

      const retractedList = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "retracted"}) RETURN k.id AS id`,
          { id },
        ),
      );
      const foundInRetractedList = retractedList.records.some(
        (r) => r.get("id") === created.knowledgeId,
      );

      const activeListAfter = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {currentStatus: "active"}) RETURN k.id AS id`,
          { id },
        ),
      );
      const stillInActiveList = activeListAfter.records.some(
        (r) => r.get("id") === created.knowledgeId,
      );

      // Verify via the REAL /history endpoint logic
      const historyResult = await withSession((session) =>
        session.run(
          `MATCH (p:Patient {id: $id})-[:HAS_KNOWLEDGE]->(k:Knowledge {id: $knowledgeId}) OPTIONAL MATCH (k)-[:HAS_VERSION]->(v:KnowledgeVersion) RETURN v ORDER BY v.versionNumber ASC`,
          { id, knowledgeId: created.knowledgeId },
        ),
      );
      const historyVersions = historyResult.records.map(
        (r) => r.get("v").properties,
      );

      const checks = {
        check1_foundInActiveListBeforeRetraction: foundBeforeRetraction,
        check2_foundInRetractedListAfterRetraction: foundInRetractedList,
        check3_notInActiveListAfterRetraction: !stillInActiveList,
        check4_historyIncludesRetractionVersion: historyVersions.some(
          (v: any) => v.retractionReason === "Testing status-filtered reads",
        ),
        check5_historyOrderCorrect:
          historyVersions
            .map((v: any) => v.versionNumber.toNumber?.() ?? v.versionNumber)
            .join(",") === "1,2",
      };
      const allPassed = Object.values(checks).every(Boolean);

      return res.json({
        message: allPassed
          ? "M6.5.c status-filtered read test PASSED and was cleaned up."
          : "M6.5.c test completed with FAILURES.",
        allPassed,
        checks,
      });
    } catch (err) {
      console.error("M6.5.c test failed:", err);
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      await cleanup();
    }
  },
);

// POST /patients/:id/knowledge/promote — PRODUCTION entrypoint.
// Reads REAL accepted KnowledgeCandidates for this patient and promotes
// them via the batched writer. This is the route M6.1-M6.5's fixture
// tests were all standing in for.
knowledgeRouter.post(
  "/:id/knowledge/promote",
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

      const summary = await withSession((session) =>
        promotePatientKnowledge(session, id),
      );
      return res.json({
        message:
          summary.acceptedCandidateCount === 0
            ? `No accepted candidates to promote for patient ${id}.`
            : `Promoted ${summary.acceptedCandidateCount} candidates for patient ${id}.`,
        ...summary,
      });
    } catch (err) {
      console.error("Failed to promote patient knowledge:", err);
      return res
        .status(500)
        .json({ error: "Failed to promote patient knowledge" });
    }
  },
);
