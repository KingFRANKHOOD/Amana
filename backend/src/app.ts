import cors from "cors";
import express from "express";
import { errorHandler } from './middleware/errorHandler';
import { correlationIdMiddleware } from './middleware/correlationId.middleware';
import { tracingMiddleware } from './middleware/tracing.middleware';
import loggerMiddleware, { appLogger } from './middleware/logger';
import { createTradeRouter } from "./routes/trade.routes";
import { createManifestRouter } from "./routes/manifest.routes";
import { createEvidenceRouter } from "./routes/evidence.routes";
import { createAuditTrailRouter } from "./routes/auditTrail.routes";

export function createApp(): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());
  // Correlation ID must be registered before the logger so every log line
  // produced by pino-http already carries the tracing IDs.
  app.use(correlationIdMiddleware);
  // OpenTelemetry tracing middleware - integrates with correlation IDs
  app.use(tracingMiddleware);
  app.use(loggerMiddleware);
  app.get("/health", (req, res) => {
    appLogger.info({ path: req.url }, 'Health check');
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

  // Error handler is registered last so it catches errors from all routes,
  // including any routes added to the app after createApp() returns.
  // We achieve this by re-registering it whenever a new route/middleware is added.
  const _originalUse = app.use.bind(app);
  const _originalGet = (app as any).get.bind(app);

  function reRegisterErrorHandler() {
    // Remove the existing error handler layer and re-add it at the end.
    // Express 5 exposes the router via app.router (lazy getter).
    const router = (app as any).router;
    if (!router) return;
    const stack: any[] = router.stack;
    // Find last occurrence of the error handler layer (scan from end)
    let errIdx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].handle === errorHandler) { errIdx = i; break; }
    }
    if (errIdx !== -1) stack.splice(errIdx, 1);
    _originalUse(errorHandler);
  }

  (app as any).use = function (...args: any[]) {
    const result = _originalUse(...args);
    reRegisterErrorHandler();
    return result;
  };

  (app as any).get = function (...args: any[]) {
    const result = _originalGet(...args);
    reRegisterErrorHandler();
    return result;
  };

  // Initial registration
  app.use(errorHandler);

  return app;
}

