import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler } from './middleware/errorHandler';
import { correlationIdMiddleware } from './middleware/correlationId.middleware';
import { tracingMiddleware } from './middleware/tracing.middleware';
import loggerMiddleware from './middleware/logger';
import { requestLoggerMiddleware } from "./middleware/request.logger.middleware";
import securityHeaders from "./middleware/securityHeaders";
import { apiVersionHeader, deprecationHeaders } from "./middleware/apiVersion.middleware";
import { authRoutes } from "./routes/auth.routes";
import { walletRoutes } from "./routes/wallet.routes";
import { createTradeRouter } from "./routes/trade.routes";
import { createTradeTemplateRouter } from "./routes/trade.template.routes";
import { createTradeWatchlistRouter } from "./routes/trade.watchlist.routes";
import { createTradeEvidenceRouter } from "./routes/trade.evidence.routes";
import { createTradeExportRouter } from "./routes/trade.export.routes";
import { createEscrowReleaseRouter } from "./routes/escrow.release.routes";
import { createEscrowScheduleRouter } from "./routes/escrow.schedule.routes";
import { createTradeManifestRouter } from "./routes/trade.manifest.routes";
import { createManifestRouter } from "./routes/manifest.routes";
import { createTradeNotesRouter } from "./routes/trade.notes.routes";
import { createEvidenceRouter } from "./routes/evidence.routes";
import { createAuditTrailRouter } from "./routes/auditTrail.routes";
import { createGoalsRouter } from "./routes/goals.routes";
import { createHealthRouter } from "./routes/health.routes";
import { createHealthDetailRouter } from "./routes/health.detail.routes";
import { createNotificationPreferencesRouter } from "./routes/notifications.preferences.routes";
import { createNotificationsRouter } from "./routes/notifications.inapp.routes";
import { createMetricsRouter } from "./routes/metrics.routes";
import { createCspRouter } from "./routes/csp.routes";
import { disputeRoutes } from "./routes/dispute.routes";
import { disputeCategoryRoutes } from "./routes/disputeCategory.routes";
import { createTreasuryRouter } from "./routes/treasury.routes";
import { createFeeAccountingRouter } from "./routes/fees.routes";
import userRoutes from "./routes/user.routes";
import reputationRoutes from "./routes/reputation.routes";
import { stellarFeesRoutes } from "./routes/stellar.fees";
import { stellarTxStatusRoutes } from "./routes/stellar.tx.status";
import { stellarAssetRoutes } from "./routes/stellar.asset";
import { stellarAccountBalanceRoutes } from "./routes/stellar.account.balance";
import { stellarAccountCreateRoutes } from "./routes/stellar.account.create";
import { createContractStateRouter } from "./routes/contract.state.routes";
import { createAdminFeaturesRouter } from "./routes/admin.features.routes";
import { createAdminEvidenceVerificationRouter } from "./routes/admin.evidence-verification.routes";
import { createAuditLogRouter } from "./routes/auditLog.routes";
import { createTrustScoreRouter } from "./routes/trust-score.routes";
import { webhooksRoutes } from "./routes/webhooks.routes";
import { createEventRouter } from "./routes/events.routes";
import { createTradeEventsRouter } from "./routes/trade.events.routes";
import { PrismaClient } from "@prisma/client";
import { EventIndexerService } from "./services/event-indexer";
import { env } from "./config/env";
import { validateEnvironment } from "./config/envValidator";
import { csrfProtection } from "./middleware/csrf.middleware";
import { requestTimeoutMiddleware } from "./middleware/request-timeout.middleware";

// Fail fast at boot if required environment variables are missing
validateEnvironment();

/** Parse the CORS_ORIGINS env var into a usable allowlist.
 *  Value should be a comma-separated list of allowed origins, e.g.:
 *    CORS_ORIGINS=https://app.amana.com,https://staging.amana.com
 *  Leave empty in development to allow all origins.
 */
function buildCorsOptions(): cors.CorsOptions {
  const raw = process.env.CORS_ORIGINS ?? env.CORS_ORIGINS ?? '';
  const allowlist = raw
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean);

  if (allowlist.length === 0) {
    const nodeEnv = process.env.NODE_ENV ?? "development";
    if (nodeEnv !== "development" && nodeEnv !== "test") {
      throw new Error(
        "CORS_ORIGINS must be configured outside development/test; refusing permissive CORS",
      );
    }

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

export function createApp(
  deps?: { prisma?: PrismaClient; eventIndexer?: EventIndexerService }
): express.Application {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  // Security headers – production-grade defaults
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https://ipfs.io", "https://*.pinata.cloud"],
          connectSrc: [
            "'self'",
            "https://api.stellar.org",
            "https://horizon.stellar.org",
            "https://horizon-testnet.stellar.org",
          ],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          reportUri: ["/api/v1/csp-violation"],
        },
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: true,
      hidePoweredBy: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      dnsPrefetchControl: { allow: false },
      xDownloadOptions: true,
    })
  );

  // Additional production security headers (layer 2 hardening)
  app.use(securityHeaders);

  // Environment-driven CORS
  app.use(cors(buildCorsOptions()));

  // Body size limits: 100 KB for JSON, 5 MB for URL-encoded (covers file references)
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Request timeout middleware — 30s default, longer for evidence/export routes
  app.use(requestTimeoutMiddleware);

  // Origin validation is mandatory for cookie-authenticated mutations.
  app.use(csrfProtection());

  // Correlation ID must be registered before the logger so every log line
  // produced by pino-http already carries the tracing IDs.
  app.use(correlationIdMiddleware);
  // OpenTelemetry tracing middleware - integrates with correlation IDs
  app.use(tracingMiddleware);
  app.use(loggerMiddleware);
  // Structured per-request logger: method, path, status, durationMs, correlationId, userId, userAgent, ip
  app.use(requestLoggerMiddleware);

  // Enhanced health check with deep introspection — not versioned (operational endpoint)
  app.use("/health", createHealthRouter());
  app.use("/health", createHealthDetailRouter());

  // Prometheus metrics endpoint — not versioned (operational endpoint)
  app.use(createMetricsRouter());

  // CSP violation report collection endpoint (helmet's reportUri above)
  app.use(createCspRouter());

  // ── Build the versioned resource router (all API routes) ──────────────────
  // This single router instance is mounted twice:
  //   1. /api/v1  — canonical, gets X-API-Version: 1
  //   2. /        — legacy unprefixed paths, gets Deprecation/Sunset headers
  // Operational endpoints (/health, /metrics-info) are intentionally excluded.
  function buildApiRouter(): express.Router {
    const r = express.Router();

    r.use("/auth", authRoutes);
    r.use("/wallet", walletRoutes);
    r.use("/users", userRoutes);
    r.use("/users", reputationRoutes);
    r.use("/users", createTrustScoreRouter());
    r.use(createNotificationPreferencesRouter());
    r.use(createNotificationsRouter());

    // These literal routes must precede the generic /trades/:id handler.
    r.use("/trades", createTradeExportRouter());
    r.use("/trades", createTradeTemplateRouter());
    r.use("/trades", createTradeWatchlistRouter());
    r.use("/trades", createTradeEvidenceRouter());
    r.use("/trades", createEscrowReleaseRouter());
    r.use("/trades", createEscrowScheduleRouter());
    r.use("/trades", createTradeRouter());
    r.use("/trades", createTradeNotesRouter());
    r.use(createTradeEventsRouter());
    r.use("/trades/:id/manifest", createTradeManifestRouter());
    r.use("/trades/:id/manifest", createManifestRouter());
    r.use(createEvidenceRouter());
    r.use("/trades", createAuditTrailRouter());

    r.use("/goals", createGoalsRouter());
    r.use("/disputes", disputeRoutes);
    r.use("/dispute-categories", disputeCategoryRoutes);

    r.use("/stellar/fees", stellarFeesRoutes);
    r.use("/stellar/tx", stellarTxStatusRoutes);
    r.use("/stellar/assets", stellarAssetRoutes);
    r.use("/stellar/account", stellarAccountCreateRoutes);
    r.use("/stellar/account", stellarAccountBalanceRoutes);
    r.use("/contract", createContractStateRouter());

    r.use("/treasury", createTreasuryRouter());
    r.use(createAdminFeaturesRouter());
    r.use(createAdminEvidenceVerificationRouter());
    r.use(createAuditLogRouter());
    r.use("/webhooks", webhooksRoutes);

    return r;
  }

  const apiRouter = buildApiRouter();

  // Versioned mount — canonical path, advertises version
  app.use("/api/v1", apiVersionHeader(1), apiRouter);

  // Legacy mount — same router, marked deprecated
  app.use("/", deprecationHeaders(env.LEGACY_API_SUNSET_DATE, "/api/v1"), apiRouter);

  // Event indexer API — requires Prisma and EventIndexerService
  if (deps?.prisma && deps?.eventIndexer) {
    app.use("/api/v1", createEventRouter(deps.prisma, deps.eventIndexer));
  }

  // Platform fee accounting & reporting (admin-only)
  app.use("/fees", createFeeAccountingRouter());

  // Error handler registered last — Express 5 natively preserves middleware
  // order so it catches errors from all routes and middleware registered above.
  app.use(errorHandler);

  return app;
}
