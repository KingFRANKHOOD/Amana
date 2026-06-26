import { Worker, Job } from 'bullmq';
import { appLogger } from '../../middleware/logger';
import { createQueueConnection, WebhookJobData } from '../queue';
import { webhookService } from '../../services/webhook.service';
export function createWebhookWorker(): Worker<WebhookJobData> {
  return new Worker<WebhookJobData>(
    'webhooks',
    async (job: Job<WebhookJobData>) => {
      const { tradeId, status, payload } = job.data;
      appLogger.info({ jobId: job.id, tradeId, status }, 'Processing webhook job');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await webhookService.dispatch(tradeId, status as any, payload);
      appLogger.info({ jobId: job.id, tradeId }, 'Webhook job completed');
    },
    { connection: createQueueConnection() },
  );
}
