import { Worker } from 'bullmq';
import { createEvidenceVerificationWorker } from './workers/evidence-verification.worker';
import { createTrustScoreRecalculationWorker } from './workers/trust-score-recalculation.worker';
import { createIdempotencyCleanupWorker } from './workers/idempotency-cleanup.worker';
import { createAuditLogRetentionWorker } from './workers/audit-log-retention.worker';
import { createDataRetentionCleanupWorker } from './workers/data-retention-cleanup.worker';
import { createDataArchivalWorker } from './workers/data-archival.worker';
import { createWebhookWorker } from './workers/webhook.worker';
import { createNotificationWorker } from './workers/notification.worker';
import { createExportWorker } from './workers/export.worker';

/**
 * Every BullMQ queue in `jobs/queue.ts` that must have a running consumer.
 *
 * This list is intentionally exhaustive: a queue without a registered worker
 * silently accumulates jobs forever (see #1478, where the webhook/notification/
 * export queues had no consumer in the cluster).
 */
export const CONSUMED_QUEUE_NAMES = [
  'webhooks',
  'notifications',
  'exports',
  'evidence-verification',
  'trust-score-recalculation',
  'idempotency-cleanup',
  'audit-log-retention',
  'data-retention-cleanup',
  'data-archival',
] as const;

export type ConsumedQueueName = (typeof CONSUMED_QUEUE_NAMES)[number];

export interface WorkerFactory {
  /** Queue name this factory consumes. Must match the Worker's queue name. */
  name: ConsumedQueueName;
  create: () => Worker;
}

/**
 * Single source of truth for which workers exist. Both the API process
 * (`index.ts`) and the dedicated worker process (`worker.ts`) start from here,
 * so a queue can never be enqueued-to without a corresponding consumer.
 */
export const WORKER_FACTORIES: WorkerFactory[] = [
  { name: 'webhooks', create: createWebhookWorker },
  { name: 'notifications', create: createNotificationWorker },
  { name: 'exports', create: createExportWorker },
  { name: 'evidence-verification', create: createEvidenceVerificationWorker },
  { name: 'trust-score-recalculation', create: createTrustScoreRecalculationWorker },
  { name: 'idempotency-cleanup', create: createIdempotencyCleanupWorker },
  { name: 'audit-log-retention', create: createAuditLogRetentionWorker },
  { name: 'data-retention-cleanup', create: createDataRetentionCleanupWorker },
  { name: 'data-archival', create: createDataArchivalWorker },
];

/** Instantiate workers for every registered factory. */
export function createAllWorkers(): Worker[] {
  return WORKER_FACTORIES.map(({ create }) => create());
}
