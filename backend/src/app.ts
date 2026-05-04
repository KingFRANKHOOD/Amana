import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler } from './middleware/errorHandler';
import { correlationIdMiddleware } from './middleware/correlationId.middleware';
import { tracingMiddleware } from './middleware/tracing.middleware';
import loggerMiddleware, { appLogger } from './middleware/logger';
import { requestIdMiddleware } from "./middleware/requestId";
import { authRoutes } from "./routes/auth.routes";
import { walletRoutes } from "./routes/wallet.routes";
import { createTradeRouter } from "./routes/trade.routes";
import { createManifestRouter } from "./routes/manifest.routes";
import { createEvidenceRouter } from "./routes/evidence.routes";
import { createAuditTrailRouter } from "./routes/auditTrail.routes";
import { createGoalsRouter } from "./routes/goals.routes";
import { createHealthRouter } from "./routes/health.routes";
import { disputeRoutes } from "./routes/dispute.routes";
import userRoutes from "./routes/user.routes";

/** Parse the CORS_ORIGINS env var into a usable allowlist.
 *  Value should be a comma-separated list of allowed origins, e.g.:
 *    CORS_ORIGINS=https://app.amana.com,https://staging.amana.com
 *  Leave empty in development to allow all origins.
 */
function buildCorsOptions(): cors.CorsOptions {
  const raw = process.env.CORS_ORIGINS ?? '';
  const allowlist = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowlist.length === 0) {
    // No allowlist configured — permissive (development only)
    return { origin: true, credentials: true };
  }

  return {
    origin: (origin, callback) => {
      // Allow server-to-server calls (no Origin header)
      if (!origin) return callback(null, true);
      if (allowlist.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  };
}

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: true,
    })
  );

  // Environment-driven CORS
  app.use(cors(buildCorsOptions()));

  // Body size limits: 100 KB for JSON, 5 MB for URL-encoded (covers file references)
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Correlation ID must be registered before the logger so every log line
  // produced by pino-http already carries the tracing IDs.
  app.use(correlationIdMiddleware);
  // OpenTelemetry tracing middleware - integrates with correlation IDs
  app.use(tracingMiddleware);
  app.use(loggerMiddleware);

  // Enhanced health check with deep introspection
  app.use("/health", createHealthRouter());

  app.use("/auth", authRoutes);
  app.use("/wallet", walletRoutes);
  app.use("/users", userRoutes);

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

  // Disputes: GET /disputes
  app.use("/disputes", disputeRoutes);

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


