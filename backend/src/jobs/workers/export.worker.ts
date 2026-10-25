import { Worker, Job } from 'bullmq';
import { createQueueConnection, ExportJobData } from '../queue';
import { prisma } from '../../lib/db';
import { Parser as CsvParser } from 'json2csv';
import { getJobContextualLogger } from '../../lib/logging';
import { bullJobDuration, bullJobFailedTotal } from '../../lib/bullMetrics';

export interface ExportResult {
  format: 'csv' | 'json';
  data: string;
  rowCount: number;
  s3Key?: string;
}

async function uploadToS3(_data: string, key: string): Promise<string | undefined> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) return undefined;
  // S3 upload requires @aws-sdk/client-s3 and AWS credentials in env.
  // Install the SDK and set AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID,
  // AWS_SECRET_ACCESS_KEY to enable actual uploads.
  const logger = getJobContextualLogger(undefined, undefined, { key, bucket });
  logger.warn('S3 upload skipped — install @aws-sdk/client-s3 to enable');
  return undefined;
}

export function createExportWorker(): Worker<ExportJobData> {
  return new Worker<ExportJobData>(
    'exports',
    async (job: Job<ExportJobData>): Promise<ExportResult> => {
      const { requestedBy, format, tradeIds, filters } = job.data;
      if (!requestedBy || typeof requestedBy !== 'string' || requestedBy.trim() === '') {
        throw new Error('Export job missing requestedBy: per-user scoping requires the requester wallet address');
      }
      // Normalize to lowercase — Trade.buyerAddress/sellerAddress are stored
      // lowercase (see eventHandlers.normalizeAddress + lib/db hook), and the
      // synchronous route (trade.export.routes.ts buildWhere) scopes with
      // OR: [{ buyerAddress }, { sellerAddress }]. Matching that contract here
      // prevents a full-table export when filters are empty.
      const owner = requestedBy.trim().toLowerCase();
      const logger = getJobContextualLogger(job.id, undefined, { requestedBy: owner, format });
      logger.info('Processing export job');
      const start = performance.now();

      try {
        // Always scope to the requesting user. Filters are intersected via AND
        // so a caller-supplied buyerAddress/sellerAddress/OR cannot broaden
        // the query beyond the requester's own trades.
        const andClauses: Record<string, unknown>[] = [];
        if (filters && Object.keys(filters).length > 0) {
          andClauses.push({ ...filters });
        }
        if (tradeIds?.length) {
          andClauses.push({ tradeId: { in: tradeIds } });
        }
        andClauses.push({ OR: [{ buyerAddress: owner }, { sellerAddress: owner }] });
        const where: Record<string, unknown> = { AND: andClauses };

        const trades = await prisma.trade.findMany({ where });

        let data: string;
        if (format === 'csv') {
          const parser = new CsvParser();
          data = parser.parse(trades);
        } else {
          data = JSON.stringify(trades, null, 2);
        }

        const s3Key = `exports/${owner}/${job.id}.${format}`;
        const s3Uri = await uploadToS3(data, s3Key);

        bullJobDuration.record((performance.now() - start) / 1000, { queue: 'exports', job_type: format });
        logger.info({ rowCount: trades.length, s3Uri }, 'Export job completed');

        return { format, data, rowCount: trades.length, s3Key: s3Uri };
      } catch (err) {
        bullJobFailedTotal.add(1, { queue: 'exports', job_type: format, error_code: 'error' });
        throw err;
      }
    },
    { connection: createQueueConnection() },
  );
}
