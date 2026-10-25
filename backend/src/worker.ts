import './config/loadEnv';
import { prisma } from './lib/db';
import { appLogger } from './middleware/logger';
import { initializeTracing } from './config/tracing';
import { createAllWorkers } from './jobs/workerRegistry';
import {
  idempotencyCleanupQueue,
  scheduleIdempotencyCleanup,
} from './jobs/workers/idempotency-cleanup.worker';
import {
  auditLogRetentionQueue,
  scheduleAuditLogRetention,
} from './jobs/workers/audit-log-retention.worker';
import { scheduleDataRetentionCleanup } from './jobs/workers/data-retention-cleanup.worker';
import { scheduleDataArchival } from './jobs/workers/data-archival.worker';
import {
  webhookQueue,
  notificationQueue,
  exportQueue,
  evidenceVerificationQueue,
  trustScoreRecalculationQueue,
  dataRetentionCleanupQueue,
  dataArchivalQueue,
} from './jobs/queue';
import {
  registerQueueForMetrics,
  startQueueMetricsCollection,
  stopQueueMetricsCollection,
} from './lib/bullMetrics';
import { createGracefulShutdown } from './lib/gracefulShutdown';
import type { Worker } from 'bullmq';

// Distributed tracing must be initialized before other imports run their
// instrumentation hooks.
initializeTracing();

const workers: Worker[] = [];

async function bootstrap(): Promise<void> {
  appLogger.info('Starting background job worker process');

  // Start every queue consumer from the single registry so no queue is left
  // without a worker (webhook/notification/export were previously orphaned).
  for (const worker of createAllWorkers()) {
    workers.push(worker);
    appLogger.info({ worker: worker.name }, 'Worker started');
  }

  // Register scheduled/repeatable jobs. BullMQ de-duplicates repeatable jobs by
  // key, so this is safe even if the API process schedules them too.
  await scheduleIdempotencyCleanup();
  await scheduleAuditLogRetention();
  await scheduleDataRetentionCleanup();
  await scheduleDataArchival();

  // Expose BullMQ queue depth metrics for the Prometheus exporter.
  registerQueueForMetrics('webhooks', webhookQueue);
  registerQueueForMetrics('notifications', notificationQueue);
  registerQueueForMetrics('exports', exportQueue);
  registerQueueForMetrics('evidence-verification', evidenceVerificationQueue);
  registerQueueForMetrics('trust-score-recalculation', trustScoreRecalculationQueue);
  registerQueueForMetrics('data-retention-cleanup', dataRetentionCleanupQueue);
  registerQueueForMetrics('data-archival', dataArchivalQueue);
  startQueueMetricsCollection();

  appLogger.info({ workerCount: workers.length }, 'All background job workers started');
}

bootstrap().catch((error) => {
  appLogger.fatal({ error }, 'Fatal worker bootstrap error');
  process.exit(1);
});

const shutdown = createGracefulShutdown({
  getServer: () => null,
  services: [],
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

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
