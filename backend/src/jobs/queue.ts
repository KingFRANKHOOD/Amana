import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function createQueueConnection(): IORedis {
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

export interface EvidenceVerificationJobData {
  triggeredBy: string;
  repairMissing?: boolean;
}

export const evidenceVerificationQueue = new Queue<EvidenceVerificationJobData>(
  'evidence-verification',
  {
    connection: createQueueConnection(),
  },
);

export interface TrustScoreRecalculationJobData {
  triggeredBy: string;
  walletAddress?: string;
}

export const trustScoreRecalculationQueue = new Queue<TrustScoreRecalculationJobData>(
  'trust-score-recalculation',
  {
    connection: createQueueConnection(),
  },
);

export interface DataRetentionJobData {
  triggeredBy: string;
}

export const dataRetentionCleanupQueue = new Queue<DataRetentionJobData>(
  'data-retention-cleanup',
  {
    connection: createQueueConnection(),
  },
);

export interface DataArchivalJobData {
  triggeredBy: string;
  thresholdDays?: number;
}

export const dataArchivalQueue = new Queue<DataArchivalJobData>(
  'data-archival',
  {
    connection: createQueueConnection(),
  },
);
