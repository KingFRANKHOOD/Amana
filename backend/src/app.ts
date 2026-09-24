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

  const r = express.Router();

  // API version negotiation headers
  r.use(apiVersionHeader);
  r.use(deprecationHeaders);

  r.use("/auth", authRoutes);
  r.use("/wallet", walletRoutes);
  r.use("/trades", createTradeRouter(deps));
  r.use("/trades", createTradeTemplateRouter());
  r.use("/trades", createTradeWatchlistRouter());
  r.use("/trades", createTradeEvidenceRouter());
  r.use("/trades", createTradeExportRouter());
  r.use("/trades", createTradeNotesRouter());
  r.use("/trades", createTradeEventsRouter());
  r.use("/trades/:id/manifest", createTradeManifestRouter());
  // NOTE: createManifestRouter() previously shared the exact same mount path as
  // createTradeManifestRouter() above, so its GET/POST "/" handlers were fully
  // shadowed and unreachable. It is now mounted on a distinct sub-path so its
  // driverIdNumber-aware schema and buildSubmitManifestTx contract flow can run.
  r.use("/trades/:id/manifest/submit", createManifestRouter());
  r.use("/escrow", createEscrowReleaseRouter());
  r.use("/escrow", createEscrowScheduleRouter());
  r.use("/evidence", createEvidenceRouter());
  r.use("/audit-trail", createAuditTrailRouter());
  r.use("/goals", createGoalsRouter());
  r.use("/notifications", createNotificationPreferencesRouter());
  r.use("/notifications", createNotificationsRouter());
  r.use("/disputes", disputeRoutes);
  r.use("/dispute-categories", disputeCategoryRoutes);
  r.use("/treasury", createTreasuryRouter());
  r.use("/fees", createFeeAccountingRouter());
  r.use("/users", userRoutes);
  r.use("/reputation", reputationRoutes);
  r.use("/stellar/fees", stellarFeesRoutes);
  r.use("/stellar/tx", stellarTxStatusRoutes);
  r.use("/stellar/assets", stellarAssetRoutes);
  r.use("/stellar/accounts", stellarAccountBalanceRoutes);
  r.use("/stellar/accounts", stellarAccountCreateRoutes);
  r.use("/contracts", createContractStateRouter());
  r.use("/admin/features", createAdminFeaturesRouter());
  r.use("/admin/evidence-verification", createAdminEvidenceVerificationRouter());
  r.use("/admin/retention", createAdminRetentionRouter());
  r.use("/admin/webhooks", createAdminWebhooksRouter());
  r.use("/audit-logs", createAuditLogRouter());
  r.use("/trust-score", createTrustScoreRouter());
  r.use("/webhooks", webhooksRoutes);
  r.use("/events", createEventRouter());

  app.use("/api/v1", r);

  app.use(errorHandler);

  return app;
}
