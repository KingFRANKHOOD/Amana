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
import { createAdminRetentionRouter } from "./routes/admin.retention.routes";
import { createAdminWebhooksRouter } from "./routes/admin.webhooks.routes";
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

  // Versioned API surface — all feature routes live under /api/v1
  function buildApiRouter(): express.Router {
    const router = express.Router();

    router.use(apiVersionHeader);
    router.use(deprecationHeaders);

    router.use("/auth", authRoutes);
    router.use("/wallet", walletRoutes);
    router.use("/trades", createTradeRouter());
    router.use("/trade-templates", createTradeTemplateRouter());
    router.use("/trade-watchlists", createTradeWatchlistRouter());
    router.use("/trade-evidence", createTradeEvidenceRouter());
    router.use("/trade-exports", createTradeExportRouter());
    router.use("/escrow-releases", createEscrowReleaseRouter());
    router.use("/escrow-schedules", createEscrowScheduleRouter());
    router.use("/trade-manifests", createTradeManifestRouter());
    router.use("/manifests", createManifestRouter());
    router.use("/trade-notes", createTradeNotesRouter());
    router.use("/evidence", createEvidenceRouter());
    router.use("/audit-trail", createAuditTrailRouter());
    router.use("/goals", createGoalsRouter());
    router.use("/notifications/preferences", createNotificationPreferencesRouter());
    router.use("/notifications", createNotificationsRouter());
    router.use("/disputes", disputeRoutes);
    router.use("/dispute-categories", disputeCategoryRoutes);
    router.use("/treasury", createTreasuryRouter());
    router.use("/fees", createFeeAccountingRouter());
    router.use("/users", userRoutes);
    router.use("/reputation", reputationRoutes);
    router.use("/stellar/fees", stellarFeesRoutes);
    router.use("/stellar/tx-status", stellarTxStatusRoutes);
    router.use("/stellar/assets", stellarAssetRoutes);
    router.use("/stellar/account-balance", stellarAccountBalanceRoutes);
    router.use("/stellar/account-create", stellarAccountCreateRoutes);
    router.use("/contract-state", createContractStateRouter());
    router.use("/admin/features", createAdminFeaturesRouter());
    router.use("/admin/evidence-verification", createAdminEvidenceVerificationRouter());
    router.use("/admin/retention", createAdminRetentionRouter());
    router.use("/admin/webhooks", createAdminWebhooksRouter());
    router.use("/audit-logs", createAuditLogRouter());
    router.use("/trust-score", createTrustScoreRouter());
    router.use("/webhooks", webhooksRoutes);
    router.use("/events", createEventRouter());
    router.use("/trade-events", createTradeEventsRouter());

    return router;
  }

  app.use("/api/v1", buildApiRouter());

  // Error handler must be registered last
  app.use(errorHandler);

  return app;
}

export default createApp;
