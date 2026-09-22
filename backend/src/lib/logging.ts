/**
 * Standardized logging utilities for consistent inclusion of trace context.
 *
 * This module provides helpers to ensure all logs include:
 * - correlationId: Logical trace ID spanning multiple requests
 * - requestId: Unique ID for this specific HTTP request
 * - trace_id: OpenTelemetry trace ID (when available)
 * - span_id: OpenTelemetry span ID (when available)
 * - service: Service name for centralized log aggregation (Loki/Promtail labels)
 *
 * Usage in controllers/handlers:
 *   getContextualLogger(req).info({ userId }, 'User action completed');
 *
 * Usage in background jobs:
 *   getJobContextualLogger(jobData).info({ result }, 'Job completed');
 */

import { trace } from '@opentelemetry/api';
import { Request } from 'express';
import { appLogger } from '../middleware/logger';
import { TracedRequest } from '../middleware/correlationId.middleware';

/**
 * Service name reported in logs. Override via SERVICE_NAME env var.
 */
const SERVICE_NAME = process.env.SERVICE_NAME || 'backend';

/**
 * Extract trace context from the active OpenTelemetry span
 */
function getTraceContext(): {
  trace_id?: string;
  span_id?: string;
} {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return {};
  }

  const spanContext = activeSpan.spanContext();
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

/**
 * Get a logger with request-level context automatically included.
 *
 * For use in Express route handlers and middleware.
 *
 * @param req - Express request object (must have correlationId and requestId)
 * @returns Child logger with context pre-filled
 *
 * @example
 * export const getUser = (req: AuthRequest, res: Response) => {
 *   const logger = getContextualLogger(req);
 *   try {
 *     const user = await userService.get(req.user.id);
 *     logger.info({ userId: user.id }, 'User fetched');
 *     res.json(user);
 *   } catch (error) {
 *     logger.error({ error }, 'Failed to fetch user');
 *     throw error;
 *   }
 * };
 */
export function getContextualLogger(req: Request) {
  const traced = req as TracedRequest;
  const traceContext = getTraceContext();

  // Create a child logger with correlation context
  return appLogger.child({
    service: SERVICE_NAME,
    correlationId: traced.correlationId,
    requestId: traced.requestId,
    ...traceContext,
  });
}

/**
 * Get a logger with job-level context automatically included.
 *
 * For use in background job workers.
 *
 * @param jobId - Unique identifier for the job
 * @param correlationId - Optional: logical trace ID to link with upstream requests
 * @param additionalContext - Optional: additional context fields (e.g., tradeId, userId)
 * @returns Child logger with context pre-filled
 *
 * @example
 * export function createNotificationWorker(): Worker<NotificationJobData> {
 *   return new Worker<NotificationJobData>(
 *     'notifications',
 *     async (job: Job<NotificationJobData>) => {
 *       const logger = getJobContextualLogger(job.id, undefined, job.data);
 *       try {
 *         await sendNotification(job.data);
 *         logger.info('Notification sent');
 *       } catch (error) {
 *         logger.error({ error }, 'Failed to send notification');
 *         throw error;
 *       }
 *     },
 *     { connection: createQueueConnection() }
 *   );
 * }
 */
export function getJobContextualLogger(
  jobId: string | number | undefined,
  correlationId?: string,
  additionalContext?: Record<string, unknown>,
) {
  const traceContext = getTraceContext();

  return appLogger.child({
    service: SERVICE_NAME,
    jobId,
    correlationId,
    ...traceContext,
    ...additionalContext,
  });
}

/**
 * Extract trace context and correlation IDs from a request for propagating
 * to downstream services (e.g., external API calls, queue jobs).
 *
 * @param req - Express request object
 * @returns Object suitable for passing as headers or job data
 *
 * @example
 * // When enqueuing a job from a request handler
 * const traceContext = extractTraceContext(req);
 * await notificationQueue.add(
 *   '/send-email',
 *   { email, message },
 *   { metadata: traceContext }
 * );
 */
export function extractTraceContext(req: Request): {
  correlationId: string;
  requestId: string;
  trace_id?: string;
  span_id?: string;
} {
  const traced = req as TracedRequest;
  const spanContext = getTraceContext();

  return {
    correlationId: traced.correlationId,
    requestId: traced.requestId,
    ...spanContext,
  };
}

/**
 * Create trace headers for propagating context to external services.
 *
 * @param req - Express request object
 * @returns Headers object with correlation/trace IDs
 *
 * @example
 * // When calling an external API
 * const headers = getTraceHeaders(req);
 * const response = await axios.post('https://api.example.com/webhook', data, { headers });
 */
export function getTraceHeaders(req: Request): Record<string, string> {
  const traced = req as TracedRequest;
  const spanContext = getTraceContext();

  return {
    'x-correlation-id': traced.correlationId,
    'x-request-id': traced.requestId,
    ...(spanContext.trace_id && { 'x-trace-id': spanContext.trace_id }),
    ...(spanContext.span_id && { 'x-span-id': spanContext.span_id }),
  };
}

/**
 * Log an error with full context automatically included.
 * Use this in error handlers and catch blocks to ensure consistent error logging.
 *
 * @param req - Express request object
 * @param error - The error to log
 * @param context - Additional context fields
 * @param message - Optional message to accompany the error
 *
 * @example
 * try {
 *   await tradeService.create(tradeData);
 * } catch (error) {
 *   logErrorWithContext(req, error, { tradeData }, 'Failed to create trade');
 *   throw error;
 * }
 */
export function logErrorWithContext(
  req: Request,
  error: Error | unknown,
  context?: Record<string, unknown>,
  message = 'Error occurred',
): void {
  const logger = getContextualLogger(req);
  const err = error instanceof Error ? error : new Error(String(error));

  logger.error(
    {
      error: {
        message: err.message,
        stack: err.stack,
      },
      ...context,
    },
    message,
  );
}

/**
 * Log a business event with context (e.g., trade created, dispute initiated).
 * Use for audit trails and business logic tracking.
 *
 * @param req - Express request object
 * @param eventType - Type of business event
 * @param details - Event details
 *
 * @example
 * logBusinessEvent(req, 'trade_created', {
 *   tradeId,
 *   buyerAddress,
 *   sellerAddress,
 *   amountUsdc,
 * });
 */
export function logBusinessEvent(
  req: Request,
  eventType: string,
  details?: Record<string, unknown>,
): void {
  const logger = getContextualLogger(req);

  logger.info(
    {
      eventType,
      ...details,
    },
    `Business event: ${eventType}`,
  );
}
