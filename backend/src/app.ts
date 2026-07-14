import express, { Express, Request, Response } from "express";
import cors from "cors";
import { eventsRouter } from "./routes/events";
import { patientsRouter } from "./routes/patients";
import { embeddingsRouter } from "./routes/embeddings";
import { gnnPatternsRouter } from "./routes/gnnPatterns";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use("/events", eventsRouter);
  app.use("/patients", patientsRouter);
  app.use("/patients", embeddingsRouter);
  app.use("/patients", gnnPatternsRouter);
  return app;
}
