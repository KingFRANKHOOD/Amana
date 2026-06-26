// Mock BullMQ and IORedis before any imports
const mockAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);

const MockQueue = jest.fn().mockImplementation(() => ({
  add: mockAdd,
  close: mockQueueClose,
}));

let workerProcessor: ((job: any) => Promise<unknown>) | null = null;
const MockWorker = jest.fn().mockImplementation(
  (_name: string, processor: (job: any) => Promise<unknown>) => {
    workerProcessor = processor;
    return { close: mockWorkerClose, on: jest.fn() };
  },
);

jest.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
}));

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ quit: jest.fn() })));

jest.mock('../middleware/logger', () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/webhook.service', () => ({
  webhookService: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../lib/db', () => ({
  prisma: {
    inAppNotification: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    trade: {
      findMany: jest.fn().mockResolvedValue([{ tradeId: 't-1', status: 'CREATED' }]),
    },
  },
}));

import { webhookService } from '../services/webhook.service';
import { prisma } from '../lib/db';

// Import queue module once — it's cached across all tests in this file
import * as QueueModule from '../jobs/queue';

beforeEach(() => {
  (webhookService.dispatch as jest.Mock).mockClear();
  (prisma.inAppNotification.create as jest.Mock).mockClear();
  (prisma.trade.findMany as jest.Mock).mockClear();
  mockAdd.mockClear();
  workerProcessor = null;
});

// ─── Queue creation ────────────────────────────────────────────────────────

describe('Queue creation', () => {
  it('creates all three queues with the correct names', () => {
    const queueNames = MockQueue.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(queueNames).toContain('webhooks');
    expect(queueNames).toContain('notifications');
    expect(queueNames).toContain('exports');
  });

  it('exports webhookQueue, notificationQueue, exportQueue', () => {
    expect(QueueModule.webhookQueue).toBeDefined();
    expect(QueueModule.notificationQueue).toBeDefined();
    expect(QueueModule.exportQueue).toBeDefined();
  });
});

// ─── Enqueue jobs ──────────────────────────────────────────────────────────

describe('Job enqueue', () => {
  it('enqueues a webhook job', async () => {
    await QueueModule.webhookQueue.add('webhook', {
      tradeId: 't-1',
      event: 'trade.funded',
      status: 'FUNDED',
      payload: {},
    });
    expect(mockAdd).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({ tradeId: 't-1' }),
    );
  });

  it('enqueues a notification job', async () => {
    await QueueModule.notificationQueue.add('notify', {
      userAddress: 'G123',
      type: 'in_app',
      title: 'Test',
      message: 'Hello',
    });
    expect(mockAdd).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ userAddress: 'G123' }),
    );
  });

  it('enqueues an export job', async () => {
    await QueueModule.exportQueue.add('export', {
      requestedBy: 'G123',
      format: 'csv',
      tradeIds: ['t-1'],
    });
    expect(mockAdd).toHaveBeenCalledWith(
      'export',
      expect.objectContaining({ format: 'csv' }),
    );
  });
});

// ─── Worker processing ─────────────────────────────────────────────────────

describe('Webhook worker processing', () => {
  beforeEach(async () => {
    const { createWebhookWorker } = await import('../jobs/workers/webhook.worker');
    createWebhookWorker();
  });

  it('dispatches webhook via webhookService', async () => {
    await workerProcessor!({
      id: 'j-1',
      data: { tradeId: 't-1', status: 'FUNDED', event: 'trade.funded', payload: { note: 'x' } },
    });
    expect(webhookService.dispatch).toHaveBeenCalledWith('t-1', 'FUNDED', { note: 'x' });
  });

  it('propagates errors from webhook dispatch (BullMQ handles retries)', async () => {
    (webhookService.dispatch as jest.Mock).mockRejectedValueOnce(new Error('network fail'));
    await expect(
      workerProcessor!({
        id: 'j-2',
        data: { tradeId: 't-2', status: 'FUNDED', event: 'trade.funded', payload: {} },
      }),
    ).rejects.toThrow('network fail');
  });
});

describe('Notification worker processing', () => {
  beforeEach(async () => {
    const { createNotificationWorker } = await import('../jobs/workers/notification.worker');
    createNotificationWorker();
  });

  it('creates in_app notification in database', async () => {
    await workerProcessor!({
      id: 'j-3',
      data: { userAddress: 'G123', type: 'in_app', title: 'Hi', message: 'World' },
    });
    expect(prisma.inAppNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userAddress: 'G123' }),
      }),
    );
  });

  it('skips DB write for email/push notifications', async () => {
    await workerProcessor!({
      id: 'j-4',
      data: { userAddress: 'G123', type: 'email', title: 'Hi', message: 'World' },
    });
    expect(prisma.inAppNotification.create).not.toHaveBeenCalled();
  });
});

describe('Export worker processing', () => {
  beforeEach(async () => {
    const { createExportWorker } = await import('../jobs/workers/export.worker');
    createExportWorker();
  });

  it('returns CSV export with rowCount', async () => {
    const result: any = await workerProcessor!({
      id: 'j-5',
      data: { requestedBy: 'G123', format: 'csv', tradeIds: ['t-1'] },
    });
    expect(result.format).toBe('csv');
    expect(result.rowCount).toBe(1);
    expect(typeof result.data).toBe('string');
  });

  it('returns JSON export', async () => {
    const result: any = await workerProcessor!({
      id: 'j-6',
      data: { requestedBy: 'G123', format: 'json' },
    });
    expect(result.format).toBe('json');
    const parsed = JSON.parse(result.data);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('propagates DB errors (BullMQ handles retries)', async () => {
    (prisma.trade.findMany as jest.Mock).mockRejectedValueOnce(new Error('db fail'));
    await expect(
      workerProcessor!({ id: 'j-7', data: { requestedBy: 'G123', format: 'json' } }),
    ).rejects.toThrow('db fail');
  });
});
