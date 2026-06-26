import { Worker, Job } from 'bullmq';
import { appLogger } from '../../middleware/logger';
import { createQueueConnection, NotificationJobData } from '../queue';
import { prisma } from '../../lib/db';

export function createNotificationWorker(): Worker<NotificationJobData> {
  return new Worker<NotificationJobData>(
    'notifications',
    async (job: Job<NotificationJobData>) => {
      const { userAddress, type, title, message, metadata } = job.data;
      appLogger.info({ jobId: job.id, userAddress, type }, 'Processing notification job');

      if (type === 'in_app') {
        await prisma.inAppNotification.create({
          data: {
            userAddress,
            title,
            message,
            type,
            metadata: metadata ?? {},
          },
        });
      } else {
        // email / push: log intent; extend with provider integration
        appLogger.info({ jobId: job.id, type, userAddress }, `${type} notification dispatched`);
      }

      appLogger.info({ jobId: job.id, userAddress }, 'Notification job completed');
    },
    { connection: createQueueConnection() },
  );
}
