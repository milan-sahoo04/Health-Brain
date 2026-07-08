import { Router, Request, Response } from "express";
import { eventSchema, toSafeLabel } from "../schemas/event.schema";
import { randomUUID } from "crypto";
import { withSession } from "../db/neo4j";
import { upsertEvent } from "../db/queries/upsertEvent";
import { buildPatientMetricSeries } from "../services/timeSeriesBuilder";
import { buildEventTimeline } from "../services/eventTimeline";
import {
  findCandidatePairs,
  correlateMetricPair,
} from "../services/correlationEngine";
import {
  persistAllPatterns,
  persistAllAssociationRules,
} from "../services/patternPersistence";
import { buildPatientCategoricalItems } from "../services/categoricalSeriesBuilder";
import { buildTransactions } from "../services/categoricalTransactionBuilder";
import { mineAssociationRules } from "../services/associationRuleMiner";

export const eventsRouter = Router();

// POST /events/bulk — import many events at once from a JSON array.
// Every event created in this call is tagged with the same importBatchId,
// so the whole import can be undone later with one delete call.

eventsRouter.post("/bulk", async (req: Request, res: Response) => {
  const body = req.body;

  if (!Array.isArray(body)) {
    return res.status(400).json({
      error: "Request body must be a JSON array of events",
    });
  }

  if (body.length === 0) {
    return res.status(400).json({ error: "Array is empty" });
  }

  if (body.length > 1000) {
    return res.status(400).json({
      error:
        "Too many events in one request (max 1000). Split into smaller batches.",
    });
  }

  const importBatchId = randomUUID();
  const importedAt = new Date().toISOString();

  const results: {
    index: number;
    status: "created" | "failed";
    error?: string;
  }[] = [];

  for (let i = 0; i < body.length; i++) {
    const parseResult = eventSchema.safeParse(body[i]);

    if (!parseResult.success) {
      results.push({
        index: i,
        status: "failed",
        error: parseResult.error.issues.map((iss) => iss.message).join("; "),
      });
      continue;
    }

    // Stamp the batch ID onto the event before writing it
    const eventWithBatch = { ...parseResult.data, importBatchId, importedAt };

    try {
      await withSession((session) => upsertEvent(session, eventWithBatch));
      results.push({ index: i, status: "created" });
    } catch (err) {
      results.push({
        index: i,
        status: "failed",
        error: err instanceof Error ? err.message : "Database write failed",
      });
    }
  }

  const createdCount = results.filter((r) => r.status === "created").length;
  const failedCount = results.length - createdCount;

  return res.status(207).json({
    message: `Imported ${createdCount} of ${body.length} events`,
    importBatchId,
    createdCount,
    failedCount,
    results,
  });
});

// POST /events — log a new patient event (Lab, Medication, Lifestyle, Weight)
eventsRouter.post("/", async (req: Request, res: Response) => {
  const parseResult = eventSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: "Invalid event payload",
      details: parseResult.error.flatten(),
    });
  }

  const event = parseResult.data;

  try {
    const record = await withSession((session) => upsertEvent(session, event));

    return res.status(201).json({
      message: "Event created",
      event,
      nodeId: record.get("e").identity.toString(),
    });
  } catch (err) {
    console.error("Failed to write event:", err);
    return res.status(500).json({ error: "Failed to save event" });
  }
});

// GET /events/batches — list all bulk imports, most recent first
eventsRouter.get("/batches", async (_req: Request, res: Response) => {
  try {
    const result = await withSession((session) =>
      session.run(
        `
        MATCH (e)
        WHERE e.importBatchId IS NOT NULL
        RETURN
          e.importBatchId AS batchId,
          count(e) AS eventCount,
          collect(DISTINCT e.patientId) AS patientIds,
          min(e.importedAt) AS importedAt
        ORDER BY importedAt DESC
        `,
      ),
    );

    const batches = result.records.map((r) => ({
      batchId: r.get("batchId"),
      eventCount: r.get("eventCount").toNumber(),
      patientIds: r.get("patientIds"),
      importedAt: r.get("importedAt"),
    }));

    return res.json({ batches });
  } catch (err) {
    console.error("Failed to fetch batches:", err);
    return res.status(500).json({ error: "Failed to fetch batches" });
  }
});

// DELETE /events/batch/:batchId — delete every event created by one import
eventsRouter.delete("/batch/:batchId", async (req: Request, res: Response) => {
  const { batchId } = req.params;

  try {
    const result = await withSession((session) =>
      session.run(
        `
        MATCH (e)
        WHERE e.importBatchId = $batchId
        DETACH DELETE e
        RETURN count(e) AS deletedCount
        `,
        { batchId },
      ),
    );

    const deletedCount = result.records[0]?.get("deletedCount").toNumber() ?? 0;

    if (deletedCount === 0) {
      return res.status(404).json({ error: "No events found for this batch" });
    }

    return res.json({
      message: `Deleted ${deletedCount} events`,
      deletedCount,
    });
  } catch (err) {
    console.error("Failed to delete batch:", err);
    return res.status(500).json({ error: "Failed to delete batch" });
  }
});

// GET /events/distinct — distinct event types and field names already in use,
// for autocomplete suggestions in the Log Event form
eventsRouter.get("/distinct", async (_req: Request, res: Response) => {
  try {
    const typesResult = await withSession((session) =>
      session.run(
        `
        MATCH (e)
        WHERE e.type IS NOT NULL
        RETURN collect(DISTINCT e.type) AS eventTypes
        `,
      ),
    );

    const fieldsResult = await withSession((session) =>
      session.run(
        `
        MATCH (e)
        WHERE e.type IS NOT NULL
        UNWIND keys(e) AS key
        WITH DISTINCT key
        WHERE NOT key IN ['id', 'patientId', 'date', 'type', 'importBatchId', 'importedAt']
        RETURN collect(key) AS fieldNames
        `,
      ),
    );

    return res.json({
      eventTypes: typesResult.records[0]?.get("eventTypes") ?? [],
      fieldNames: fieldsResult.records[0]?.get("fieldNames") ?? [],
    });
  } catch (err) {
    console.error("Failed to fetch distinct values:", err);
    return res.status(500).json({ error: "Failed to fetch distinct values" });
  }
});

// GET /events/:patientId/correlations — diagnostic route, Phase B.
// Computes lag-correlated metric pairs, excluding confounded observations.
eventsRouter.get(
  "/:patientId/correlations",
  async (req: Request, res: Response) => {
    const patientId = req.params.patientId;
    if (typeof patientId !== "string") {
      return res.status(400).json({ error: "Invalid patientId" });
    }

    try {
      const [seriesMap, timeline] = await withSession(async (session) => {
        const s = await buildPatientMetricSeries(session, patientId);
        const t = await buildEventTimeline(session, patientId);
        return [s, t] as const;
      });

      const pairs = findCandidatePairs(seriesMap);
      const results = [];
      for (const [seriesA, seriesB] of pairs) {
        const typeA = seriesA.metricName.split(":")[0];
        const typeB = seriesB.metricName.split(":")[0];
        const result = correlateMetricPair(
          seriesA,
          seriesB,
          timeline,
          typeA,
          typeB,
        );
        if (result) results.push(result);
      }

      results.sort((a, b) => b.confidence - a.confidence);
      return res.json({ patientId, pairsTested: pairs.length, results });
    } catch (err) {
      console.error("Failed to compute correlations:", err);
      return res.status(500).json({ error: "Failed to compute correlations" });
    }
  },
);

// GET /events/:patientId/series — diagnostic route, Phase B.
// Returns extracted numeric metric series for a patient.
eventsRouter.get("/:patientId/series", async (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (typeof patientId !== "string") {
    return res.status(400).json({ error: "Invalid patientId" });
  }

  try {
    const seriesMap = await withSession((session) =>
      buildPatientMetricSeries(session, patientId),
    );
    const series = Array.from(seriesMap.values()).map((s) => ({
      metricName: s.metricName,
      pointCount: s.points.length,
      points: s.points,
    }));
    return res.json({ patientId, metrics: series });
  } catch (err) {
    console.error("Failed to build series:", err);
    return res.status(500).json({ error: "Failed to build series" });
  }
});

// GET /events/:patientId/associations — diagnostic route, Phase C.
// Mines pairwise association rules from categorical events.
eventsRouter.get(
  "/:patientId/associations",
  async (req: Request, res: Response) => {
    const { patientId } = req.params;
    if (typeof patientId !== "string") {
      return res.status(400).json({ error: "Invalid patientId" });
    }

    try {
      const items = await withSession((session) =>
        buildPatientCategoricalItems(session, patientId),
      );
      const transactions = buildTransactions(items);
      const rules = mineAssociationRules(transactions);

      return res.json({
        patientId,
        totalItems: items.length,
        totalTransactions: transactions.length,
        transactions,
        rules,
      });
    } catch (err) {
      console.error("Failed to mine associations:", err);
      return res.status(500).json({ error: "Failed to mine associations" });
    }
  },
);

// POST /events/:patientId/synthesize — runs the FULL Phase B + Phase C pipeline:
// correlation engine (numeric metrics) + association rule mining (categorical
// events), both persisted as (:Pattern) nodes distinguished by `method`.
eventsRouter.post(
  "/:patientId/synthesize",
  async (req: Request, res: Response) => {
    const { patientId } = req.params;
    if (typeof patientId !== "string") {
      return res.status(400).json({ error: "Invalid patientId" });
    }

    try {
      const { correlationSummaries, associationSummaries } = await withSession(
        async (session) => {
          // Phase B: correlation
          const seriesMap = await buildPatientMetricSeries(session, patientId);
          const timeline = await buildEventTimeline(session, patientId);
          const pairs = findCandidatePairs(seriesMap);

          const correlationResults = [];
          for (const [seriesA, seriesB] of pairs) {
            const typeA = seriesA.metricName.split(":")[0];
            const typeB = seriesB.metricName.split(":")[0];
            const result = correlateMetricPair(
              seriesA,
              seriesB,
              timeline,
              typeA,
              typeB,
            );
            if (result) correlationResults.push(result);
          }
          const correlationSummaries = await persistAllPatterns(
            session,
            patientId,
            correlationResults,
          );

          // Phase C: association rule mining
          const items = await buildPatientCategoricalItems(session, patientId);
          const transactions = buildTransactions(items);
          const associationRules = mineAssociationRules(transactions);
          const associationSummaries = await persistAllAssociationRules(
            session,
            patientId,
            associationRules,
          );

          return { correlationSummaries, associationSummaries };
        },
      );

      const allSummaries = [...correlationSummaries, ...associationSummaries];
      const activeCount = allSummaries.filter(
        (s) => s.status === "active",
      ).length;
      const belowThresholdCount = allSummaries.filter(
        (s) => s.status === "below_threshold",
      ).length;

      return res.json({
        patientId,
        message: `Synthesis complete: ${activeCount} active patterns, ${belowThresholdCount} below threshold`,
        correlationPatterns: correlationSummaries,
        associationPatterns: associationSummaries,
      });
    } catch (err) {
      console.error("Failed to run synthesis:", err);
      return res.status(500).json({ error: "Failed to run synthesis" });
    }
  },
);

// GET /events/:patientId — fetch all events for a patient, most recent first
eventsRouter.get("/:patientId", async (req: Request, res: Response) => {
  const { patientId } = req.params;

  try {
    const records = await withSession((session) =>
      session.run(
        `
        MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
        RETURN e
        ORDER BY e.date DESC
        `,
        { patientId },
      ),
    );

    const events = records.records.map((r) => {
      const node = r.get("e");
      return {
        id: node.identity.toString(), // needed so the frontend can delete this specific event
        ...node.properties,
      };
    });

    return res.json({ patientId, count: events.length, events });
  } catch (err) {
    console.error("Failed to fetch events:", err);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});

// DELETE /events/:patientId/:eventId — remove one event node
eventsRouter.delete(
  "/:patientId/:eventId",
  async (req: Request, res: Response) => {
    const { patientId, eventId } = req.params;

    try {
      const result = await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
        WHERE id(e) = toInteger($eventId)
        DETACH DELETE e
        RETURN count(e) AS deletedCount
        `,
          { patientId, eventId },
        ),
      );

      const deletedCount =
        result.records[0]?.get("deletedCount").toNumber() ?? 0;

      if (deletedCount === 0) {
        return res
          .status(404)
          .json({ error: "Event not found for this patient" });
      }

      return res.json({ message: "Event deleted" });
    } catch (err) {
      console.error("Failed to delete event:", err);
      return res.status(500).json({ error: "Failed to delete event" });
    }
  },
);

// GET /events/:patientId/graph — returns nodes + edges shaped for visualization
eventsRouter.get("/:patientId/graph", async (req: Request, res: Response) => {
  const { patientId } = req.params;

  try {
    const result = await withSession((session) =>
      session.run(
        `
        MATCH (p:Patient {id: $patientId})-[r:HAS_EVENT]->(e)
        RETURN p, r, e
        `,
        { patientId },
      ),
    );

    if (result.records.length === 0) {
      return res.json({ nodes: [], edges: [] });
    }

    // Patient node appears once — grab it from the first record
    const patientNode = result.records[0].get("p");
    const nodes = [
      {
        id: patientNode.identity.toString(),
        label: "Patient",
        properties: patientNode.properties,
      },
    ];
    const edges: { source: string; target: string; label: string }[] = [];

    for (const record of result.records) {
      const eventNode = record.get("e");
      const eventId = eventNode.identity.toString();

      nodes.push({
        id: eventId,
        label: eventNode.labels[0], // e.g. "LabEvent"
        properties: eventNode.properties,
      });

      edges.push({
        source: patientNode.identity.toString(),
        target: eventId,
        label: "HAS_EVENT",
      });
    }

    return res.json({ nodes, edges });
  } catch (err) {
    console.error("Failed to fetch graph:", err);
    return res.status(500).json({ error: "Failed to fetch graph" });
  }
});

// PUT /events/:patientId/:eventId — update an existing event's data (type cannot change)
eventsRouter.put(
  "/:patientId/:eventId",
  async (req: Request, res: Response) => {
    const { patientId, eventId } = req.params;

    const parseResult = eventSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid event payload",
        details: parseResult.error.flatten(),
      });
    }

    const updatedEvent = parseResult.data;

    if (updatedEvent.patientId !== patientId) {
      return res
        .status(400)
        .json({ error: "patientId in body must match URL" });
    }

    try {
      // First check the existing node's label matches the submitted type —
      // prevents silently corrupting a LabEvent into MedicationEvent-shaped data
      const existing = await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
        WHERE id(e) = toInteger($eventId)
        RETURN labels(e) AS labels
        `,
          { patientId, eventId },
        ),
      );

      if (existing.records.length === 0) {
        return res
          .status(404)
          .json({ error: "Event not found for this patient" });
      }

      const existingLabels: string[] = existing.records[0].get("labels");
      const expectedLabel = toSafeLabel(updatedEvent.type);

      if (!existingLabels.includes(expectedLabel)) {
        return res.status(400).json({
          error: `Cannot change event type. This event is ${existingLabels[0]}, delete and re-add instead if you need a different type.`,
        });
      }

      // Overwrite all properties with the new validated data
      await withSession((session) =>
        session.run(
          `
        MATCH (p:Patient {id: $patientId})-[:HAS_EVENT]->(e)
        WHERE id(e) = toInteger($eventId)
        SET e = $props
        RETURN e
        `,
          { patientId, eventId, props: updatedEvent },
        ),
      );

      return res.json({ message: "Event updated", event: updatedEvent });
    } catch (err) {
      console.error("Failed to update event:", err);
      return res.status(500).json({ error: "Failed to update event" });
    }
  },
);
