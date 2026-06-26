import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function createQueueConnection(): IORedis {
  // @ts-expect-error - ioredis URL+options constructor is valid at runtime
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export interface WebhookJobData {
  tradeId: string;
  event: string;
  status: string;
  payload: Record<string, unknown>;
}

export interface NotificationJobData {
  userAddress: string;
  type: 'in_app' | 'email' | 'push';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ExportJobData {
  requestedBy: string;
  format: 'csv' | 'json';
  tradeIds?: string[];
  filters?: Record<string, unknown>;
}

export const webhookQueue = new Queue<WebhookJobData>('webhooks', {
  connection: createQueueConnection(),
});

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection: createQueueConnection(),
});

export const exportQueue = new Queue<ExportJobData>('exports', {
  connection: createQueueConnection(),
});
