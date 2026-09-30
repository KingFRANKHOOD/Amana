import { AppError, ErrorCode, isAppError, StructuredErrorPayload } from './errorCodes';

/**
 * Context describing where a service error originated, used to enrich the
 * structured payload produced by {@link convertServiceError}.
 */
export interface StructuredErrorContext {
  service?: string;
  operation?: string;
  [key: string]: unknown;
}

/**
 * Convert an arbitrary thrown value into a structured {@link AppError}.
 *
 * Preserves already-structured errors (AppError instances) and maps known
 * service error codes onto their canonical {@link ErrorCode} counterparts.
 */
export function convertServiceError(
  error: unknown,
  context: StructuredErrorContext = {},
): AppError {
  if (isAppError(error)) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown service error';

  const details: StructuredErrorPayload = {
    ...context,
    cause: error instanceof Error ? error.name : undefined,
  };

  return new AppError(ErrorCode.INFRA_ERROR, message, 500, details);
}
