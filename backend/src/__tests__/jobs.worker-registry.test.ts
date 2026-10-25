/**
 * jobs.worker-registry.test.ts
 *
 * Guards against the #1478 regression where jobs were enqueued onto
 * webhook/notification/export queues but no process ever consumed them.
 *
 * Every worker module is mocked so this test exercises only the registry
 * wiring (no Redis/DB/BullMQ side effects).
 */

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));

jest.mock('../jobs/workers/webhook.worker', () => ({
  createWebhookWorker: () => ({ name: 'webhooks' }),
}));
jest.mock('../jobs/workers/notification.worker', () => ({
  createNotificationWorker: () => ({ name: 'notifications' }),
}));
jest.mock('../jobs/workers/export.worker', () => ({
  createExportWorker: () => ({ name: 'exports' }),
}));
jest.mock('../jobs/workers/evidence-verification.worker', () => ({
  createEvidenceVerificationWorker: () => ({ name: 'evidence-verification' }),
}));
jest.mock('../jobs/workers/trust-score-recalculation.worker', () => ({
  createTrustScoreRecalculationWorker: () => ({ name: 'trust-score-recalculation' }),
}));
jest.mock('../jobs/workers/idempotency-cleanup.worker', () => ({
  createIdempotencyCleanupWorker: () => ({ name: 'idempotency-cleanup' }),
}));
jest.mock('../jobs/workers/audit-log-retention.worker', () => ({
  createAuditLogRetentionWorker: () => ({ name: 'audit-log-retention' }),
}));
jest.mock('../jobs/workers/data-retention-cleanup.worker', () => ({
  createDataRetentionCleanupWorker: () => ({ name: 'data-retention-cleanup' }),
}));
jest.mock('../jobs/workers/data-archival.worker', () => ({
  createDataArchivalWorker: () => ({ name: 'data-archival' }),
}));

import {
  CONSUMED_QUEUE_NAMES,
  WORKER_FACTORIES,
  createAllWorkers,
} from '../jobs/workerRegistry';

describe('worker registry', () => {
  it('registers exactly one worker per consumed queue', () => {
    const registered = WORKER_FACTORIES.map((f) => f.name);
    expect(registered).toHaveLength(CONSUMED_QUEUE_NAMES.length);
    expect(new Set(registered)).toEqual(new Set(CONSUMED_QUEUE_NAMES));
  });

  it('covers the previously orphaned webhook / notification / export queues', () => {
    const registered = WORKER_FACTORIES.map((f) => f.name);
    expect(registered).toEqual(
      expect.arrayContaining(['webhooks', 'notifications', 'exports']),
    );
  });

  it('createAllWorkers instantiates one worker per registered queue, in order', () => {
    const workers = createAllWorkers();
    expect(workers).toHaveLength(CONSUMED_QUEUE_NAMES.length);
    expect((workers as Array<{ name: string }>).map((w) => w.name)).toEqual([
      ...CONSUMED_QUEUE_NAMES,
    ]);
  });
});
