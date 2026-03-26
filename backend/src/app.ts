import cors from "cors";
import express from "express";
import pinoHttp from 'pino-http';
import { errorHandler } from './middleware/errorHandler';
import loggerMiddleware from './middleware/logger';
import { createTradeRouter } from "./routes/trade.routes";
import { createManifestRouter } from "./routes/manifest.routes";
import { createEvidenceRouter } from "./routes/evidence.routes";
import { createAuditTrailRouter } from "./routes/auditTrail.routes";
import { env } from './config/env';

const logger = pinoHttp.logger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
});

export function createApp(): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(loggerMiddleware);
  app.get("/health", (req, res) => {
    logger.info({ path: req.path }, 'Health check');
    res.status(200).json({
      status: "ok",
      service: "amana-backend",
      timestamp: new Date().toISOString(),
    });
  });

  const tradeRouter = createTradeRouter();
  app.use("/trades", tradeRouter);

  // Manifest: POST /trades/:id/manifest
  app.use("/trades/:id/manifest", createManifestRouter());

  // Evidence: GET /trades/:id/evidence and GET /evidence/:cid/stream
  app.use(createEvidenceRouter());

  // Audit trail: GET /trades/:id/history
  app.use("/trades", createAuditTrailRouter());

  app.use(errorHandler);
  return app;
}

