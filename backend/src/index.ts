import "./config/loadEnv";
import fs from "fs";
import path from "path";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { prisma } from "./lib/db";
import { EventListenerService } from "./services/eventListener.service";
import { EventIndexerService } from "./services/event-indexer";
import { EventStreamService } from "./services/event-stream";
import { createApp } from "./app";
import { env } from "./config/env";
import { appLogger } from "./middleware/logger";
import { initializeTracing } from "./config/tracing";
import { HealthService } from "./services/health.service";
import { createEvidenceVerificationWorker } from "./jobs/workers/evidence-verification.worker";
import { createTrustScoreRecalculationWorker } from "./jobs/workers/trust-score-recalculation.worker";
import {
  createIdempotencyCleanupWorker,
  idempotencyCleanupQueue,
  scheduleIdempotencyCleanup,
} from "./jobs/workers/idempotency-cleanup.worker";
import {
  createAuditLogRetentionWorker,
  auditLogRetentionQueue,
  scheduleAuditLogRetention,
} from "./jobs/workers/audit-log-retention.worker";
import {
  createDataRetentionCleanupWorker,
  scheduleDataRetentionCleanup,
} from "./jobs/workers/data-retention-cleanup.worker";
import {
  createDataArchivalWorker,
  scheduleDataArchival,
} from "./jobs/workers/data-archival.worker";
import {
  evidenceVerificationQueue,
  trustScoreRecalculationQueue,
  webhookQueue,
  notificationQueue,
  exportQueue,
  dataRetentionCleanupQueue,
  dataArchivalQueue,
} from "./jobs/queue";
import { storageMonitoringService } from "./services/storageMonitoring.service";
import {
  registerQueueForMetrics,
  startQueueMetricsCollection,
  stopQueueMetricsCollection,
} from "./lib/bullMetrics";
import { createGracefulShutdown } from "./lib/gracefulShutdown";
import type { Server } from "http";


// Initialize distributed tracing before any other imports
initializeTracing();

const eventIndexerService = new EventIndexerService(prisma);
const app = createApp({ prisma, eventIndexer: eventIndexerService });
const port = env.PORT;

const docsDir = path.join(__dirname, "docs");
const openapiYamlPath = path.join(docsDir, "openapi.yaml");
const openapiJsonPath = path.join(docsDir, "openapi.json");

let openapiSpec: Record<string, unknown> | null = null;
try {
  openapiSpec = YAML.load(openapiYamlPath) as Record<string, unknown>;
} catch (error) {
  appLogger.warn({ error }, "OpenAPI spec could not be loaded");
}

if (env.NODE_ENV !== "production" && openapiSpec) {
  // Override server URL from env so Try It Out links work in deployed environments
  if (env.API_PUBLIC_URL && Array.isArray(openapiSpec.servers)) {
    openapiSpec.servers = [{ url: env.API_PUBLIC_URL }];
  }

  // Auto-generate stable operationId for every operation so generated docs
  // have consistent anchor links and code-gen-friendly function names
  if (typeof openapiSpec.paths === "object" && openapiSpec.paths) {
    for (const [path, methods] of Object.entries(
      openapiSpec.paths as Record<string, unknown>,
    )) {
      for (const [method, operation] of Object.entries(
        methods as Record<string, unknown>,
      )) {
        if (typeof operation === "object" && operation !== null && !(operation as Record<string, unknown>).operationId) {
          const safePath = path
            .replace(/[{}]/g, "")
            .replace(/[^a-zA-Z0-9_/]/g, "_")
            .replace(/\/+/g, ".")
            .replace(/^\.|\.$/g, "")
            .replace(/\.+/g, ".");
          (operation as Record<string, unknown>).operationId = `${method}${safePath ? `.${safePath}` : ""}`;
        }
      }
    }
  }

  try {
    fs.writeFileSync(openapiJsonPath, JSON.stringify(openapiSpec, null, 2));
  } catch (error) {
    appLogger.warn({ error }, "OpenAPI spec could not be exported");
  }

  app.get("/api/docs/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
}

const eventListenerService = new EventListenerService(prisma);
const healthService = new HealthService();
let eventStreamService: EventStreamService | null = null;
const workers = [] as Array<{ close: () => Promise<void> }>;
const services: Array<{ close: () => Promise<void> | void }> = [
  { close: () => eventListenerService.stop() },
  { close: () => eventIndexerService.stop() },
];
let httpServer: Server | null = null;

async function bootstrap() {
  const isTest = (process.env.NODE_ENV ?? env.NODE_ENV) === "test";

  if (!isTest) {
    appLogger.info("Performing startup readiness check...");
    try {
      const startupCheck = await healthService.performStartupCheck();
      if (startupCheck.status !== "ready") {
        appLogger.fatal({ checks: startupCheck.checks }, "Critical startup dependencies are not ready. Exiting.");
        process.exit(1);
      }
      appLogger.info("Startup readiness check passed.");
    } catch (error) {
      appLogger.fatal({ error }, "Failed to perform startup check. Exiting.");
      process.exit(1);
    }
  }

  httpServer = app.listen(port, async () => {
    appLogger.info({ port }, "Amana backend listening");

    try {
      await eventListenerService.start();
      appLogger.info("EventListenerService started successfully");
    } catch (error) {
      appLogger.error({ error }, "Failed to start EventListenerService");
    }

    try {
      await eventIndexerService.start();
      appLogger.info("EventIndexerService started successfully");
    } catch (error) {
      appLogger.error({ error }, "Failed to start EventIndexerService");
    }

    try {
      eventStreamService = new EventStreamService(httpServer!);
      services.push({ close: () => eventStreamService?.stop() });
      appLogger.info("EventStreamService initialized");
    } catch (error) {
      appLogger.warn({ error }, "Failed to initialize EventStreamService");
    }

    // Register BullMQ queues for Prometheus metrics and start collection
    registerQueueForMetrics("webhooks", webhookQueue);
    registerQueueForMetrics("notifications", notificationQueue);
    registerQueueForMetrics("exports", exportQueue);
    registerQueueForMetrics("evidence-verification", evidenceVerificationQueue);
    registerQueueForMetrics("trust-score-recalculation", trustScoreRecalculationQueue);
    registerQueueForMetrics("data-retention-cleanup", dataRetentionCleanupQueue);
    registerQueueForMetrics("data-archival", dataArchivalQueue);
    startQueueMetricsCollection();

    // Start evidence verification worker for async jobs
    try {
      workers.push(createEvidenceVerificationWorker());
      appLogger.info("EvidenceVerificationWorker started");
    } catch (error) {
      appLogger.error({ error }, "Failed to start EvidenceVerificationWorker");
    }

    // Start trust score recalculation worker
    try {
      workers.push(createTrustScoreRecalculationWorker());
      appLogger.info("TrustScoreRecalculationWorker started");
    } catch (error) {
      appLogger.error({ error }, "Failed to start TrustScoreRecalculationWorker");
    }

    // Start idempotency key GC worker and schedule daily cron
    try {
      workers.push(createIdempotencyCleanupWorker());
      await scheduleIdempotencyCleanup();
      appLogger.info("IdempotencyCleanupWorker started");
    } catch (error) {
      appLogger.error({ error }, "Failed to start IdempotencyCleanupWorker");
    }

    // Start audit log retention worker and schedule daily cron
    try {
      workers.push(createAuditLogRetentionWorker());
      await scheduleAuditLogRetention();
      appLogger.info("AuditLogRetentionWorker started");
    } catch (error) {
      appLogger.error({ error }, "Failed to start AuditLogRetentionWorker");
    }

    // Start comprehensive data retention cleanup worker and schedule daily cron
    try {
      workers.push(createDataRetentionCleanupWorker());
      await scheduleDataRetentionCleanup();
      appLogger.info("DataRetentionCleanupWorker started");
    } catch (error) {
      appLogger.error({ error }, "Failed to start DataRetentionCleanupWorker");
    }

    // Start cold data archival worker and schedule weekly cron
    try {
      workers.push(createDataArchivalWorker());
      await scheduleDataArchival();
      appLogger.info("DataArchivalWorker started");
    } catch (error) {
      appLogger.error({ error }, "Failed to start DataArchivalWorker");
    }

    // Schedule periodic evidence pin verification & storage monitoring
    const isTest = (process.env.NODE_ENV ?? env.NODE_ENV) === "test";
    if (!isTest) {
      const intervalMs = env.EVIDENCE_PIN_VERIFICATION_INTERVAL_MS;
      appLogger.info({ intervalMs }, "Scheduling periodic evidence pin verification");

      const runVerification = async () => {
        try {
          appLogger.info("Running scheduled evidence pin verification");
          const job = await evidenceVerificationQueue.add("verify", {
            triggeredBy: "scheduled",
            repairMissing: false,
          });
          appLogger.info({ jobId: job.id }, "Scheduled verification job queued");
        } catch (error) {
          appLogger.error({ error }, "Failed to schedule evidence verification");
        }
      };

      // Run initial verification after a short delay to avoid startup contention
      setTimeout(() => {
        runVerification().catch(() => {});
      }, 60_000);

      // Then run on the configured interval
      setInterval(() => {
        runVerification().catch(() => {});
      }, intervalMs);

      // Schedule periodic trust score recalculation
      const trustScoreIntervalMs = env.TRUST_SCORE_RECALCULATION_INTERVAL_MS;
      appLogger.info({ intervalMs: trustScoreIntervalMs }, "Scheduling periodic trust score recalculation");

      const runTrustScoreRecalculation = async () => {
        try {
          appLogger.info("Running scheduled trust score recalculation");
          const job = await trustScoreRecalculationQueue.add("recalculate", {
            triggeredBy: "scheduled",
          });
          appLogger.info({ jobId: job.id }, "Scheduled trust score recalculation job queued");
        } catch (error) {
          appLogger.error({ error }, "Failed to schedule trust score recalculation");
        }
      };

      setTimeout(() => {
        runTrustScoreRecalculation().catch(() => {});
      }, 120_000);

      setInterval(() => {
        runTrustScoreRecalculation().catch(() => {});
      }, trustScoreIntervalMs);

      // Schedule periodic storage growth monitoring
      const storageIntervalMs = env.STORAGE_MONITORING_INTERVAL_MS;
      appLogger.info({ intervalMs: storageIntervalMs }, "Scheduling periodic storage monitoring");

      const runStorageCollection = async () => {
        try {
          appLogger.info("Running scheduled storage growth metrics collection");
          await storageMonitoringService.collectStorageMetrics();
        } catch (error) {
          appLogger.warn({ error }, "Failed to collect scheduled storage metrics");
        }
      };

      setTimeout(() => {
        runStorageCollection().catch(() => {});
      }, 30_000);

      setInterval(() => {
        runStorageCollection().catch(() => {});
      }, storageIntervalMs);
    }
  });
}

bootstrap().catch((error) => {
  appLogger.fatal({ error }, "Fatal bootstrap error");
  process.exit(1);
});

const shutdown = createGracefulShutdown({
  getServer: () => httpServer,
  services,
  workers,
  queues: [
    webhookQueue,
    notificationQueue,
    exportQueue,
    evidenceVerificationQueue,
    trustScoreRecalculationQueue,
    idempotencyCleanupQueue,
    auditLogRetentionQueue,
    dataRetentionCleanupQueue,
    dataArchivalQueue,
  ],
  stopMetrics: stopQueueMetricsCollection,
  disconnectDatabase: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
