import cors from "cors";
import express from "express";
import { errorHandler } from './middleware/errorHandler';
import loggerMiddleware, { appLogger } from './middleware/logger';
import { createTradeRouter } from "./routes/trade.routes";
import { createManifestRouter } from "./routes/manifest.routes";
import { createEvidenceRouter } from "./routes/evidence.routes";
import { createAuditTrailRouter } from "./routes/auditTrail.routes";
import { createGoalsRouter } from "./routes/goals.routes";
import { createHealthRouter } from "./routes/health.routes";

export function createApp(): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(loggerMiddleware);

  // Enhanced health check with deep introspection
  app.use("/health", createHealthRouter());

  const tradeRouter = createTradeRouter();
  app.use("/trades", tradeRouter);

  // Manifest: POST /trades/:id/manifest
  app.use("/trades/:id/manifest", createManifestRouter());

  // Evidence: GET /trades/:id/evidence and GET /evidence/:cid/stream
  app.use(createEvidenceRouter());

  // Audit trail: GET /trades/:id/history
  app.use("/trades", createAuditTrailRouter());

  // Goals analytics: GET /goals
  app.use("/goals", createGoalsRouter());

  app.use(errorHandler);
  return app;
}

