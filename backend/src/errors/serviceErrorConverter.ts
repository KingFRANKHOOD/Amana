import { AppError, ErrorCode } from './errorCodes';
import { appLogger } from '../middleware/logger';

/**
 * External service error types that need conversion
 */
export interface ExternalServiceError {
  message?: string;
  code?: string | number;
  status?: number;
  response?: {
    status?: number;
    data?: any;
    statusText?: string;
  };
  network?: boolean;
  timeout?: boolean;
}

/**
 * Service type for better error classification
 */
export enum ServiceType {
  STELLAR = 'stellar',
  IPFS = 'ipfs',
  DATABASE = 'database',
  REDIS = 'redis',
  WEBHOOK = 'webhook',
  EXTERNAL_API = 'external_api',
}

/**
 * Centralized error conversion utility for external services
 * Converts various external service error formats to backend API error types
 */
export class ServiceErrorConverter {
  /**
   * Convert any external service error to AppError
   */
  static convertToAppError(
    error: unknown,
    serviceType: ServiceType,
    context?: string
  ): AppError {
    // If already an AppError, return as-is
    if (error instanceof AppError) {
      return error;
    }

    // Handle structured AppError across boundaries
    if (this.isAppErrorStructural(error)) {
      return error as AppError;
    }

    const externalError = error as ExternalServiceError;
    const serviceContext = context || serviceType;

    // Network/timeout errors
    if (this.isNetworkError(externalError)) {
      appLogger.warn(
        { service: serviceType, error: externalError.message },
        `[${serviceContext}] Network error detected`
      );
      return new AppError(
        ErrorCode.INFRA_ERROR,
        `${serviceContext} service unavailable: Network error`,
        503,
        { service: serviceType, originalError: externalError.message }
      );
    }

    // Timeout errors
    if (this.isTimeoutError(externalError)) {
      appLogger.warn(
        { service: serviceType, error: externalError.message },
        `[${serviceContext}] Timeout error detected`
      );
      return new AppError(
        ErrorCode.PAYMENT_PROVIDER_TIMEOUT,
        `${serviceContext} service timeout`,
        504,
        { service: serviceType, originalError: externalError.message }
      );
    }

    // HTTP status errors
    if (externalError.response?.status) {
      return this.convertHttpError(externalError, serviceType, serviceContext);
    }

    // Generic unknown error
    appLogger.error(
      { service: serviceType, error },
      `[${serviceContext}] Unknown error type`
    );
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      `${serviceContext} service error: ${this.extractMessage(error)}`,
      500,
      { service: serviceType }
    );
  }

  /**
   * Convert HTTP status errors to appropriate AppError
   */
  private static convertHttpError(
    error: ExternalServiceError,
    serviceType: ServiceType,
    context: string
  ): AppError {
    const status = error.response?.status || 0;
    const statusText = error.response?.statusText || 'Unknown';
    const responseData = error.response?.data;

    switch (status) {
      case 400:
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          `${context} service rejected request: ${statusText}`,
          400,
          { service: serviceType, response: responseData }
        );

      case 401:
      case 403:
        return new AppError(
          ErrorCode.AUTH_ERROR,
          `${context} service authentication failed`,
          401,
          { service: serviceType, response: responseData }
        );

      case 404:
        return new AppError(
          ErrorCode.NOT_FOUND,
          `${context} resource not found`,
          404,
          { service: serviceType }
        );

      case 429:
        return new AppError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          `${context} rate limit exceeded`,
          429,
          { service: serviceType, response: responseData }
        );

      case 500:
      case 502:
      case 503:
        return new AppError(
          ErrorCode.PAYMENT_PROVIDER_ERROR,
          `${context} service unavailable (${status})`,
          503,
          { service: serviceType, status, statusText }
        );

      case 504:
        return new AppError(
          ErrorCode.PAYMENT_PROVIDER_TIMEOUT,
          `${context} service timeout`,
          504,
          { service: serviceType }
        );

      default:
        return new AppError(
          ErrorCode.INFRA_ERROR,
          `${context} service error: ${status} ${statusText}`,
          status,
          { service: serviceType, response: responseData }
        );
    }
  }

  /**
   * Check if error is a network error
   */
  private static isNetworkError(error: ExternalServiceError): boolean {
    if (error.network) return true;
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout') ||
      message.includes('connection reset') ||
      message.includes('connection refused')
    );
  }

  /**
   * Check if error is a timeout error
   */
  private static isTimeoutError(error: ExternalServiceError): boolean {
    if (error.timeout) return true;
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('time out')
    );
  }

  /**
   * Extract error message from various error formats
   */
  private static extractMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null) {
      const err = error as { message?: string; error?: string };
      return err.message || err.error || 'Unknown error';
    }
    return 'Unknown error';
  }

  /**
   * Structural check for AppError across module boundaries
   */
  private static isAppErrorStructural(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AppError' &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number' &&
      typeof (error as { message?: unknown }).message === 'string'
    );
  }

  /**
   * Wrap async service calls with automatic error conversion
   */
  static async withErrorConversion<T>(
    fn: () => Promise<T>,
    serviceType: ServiceType,
    context?: string
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.convertToAppError(error, serviceType, context);
    }
  }

  /**
   * Convert Stellar-specific errors
   */
  static convertStellarError(error: unknown, context?: string): AppError {
    return this.convertToAppError(error, ServiceType.STELLAR, context);
  }

  /**
   * Convert IPFS-specific errors
   */
  static convertIPFSError(error: unknown, context?: string): AppError {
    return this.convertToAppError(error, ServiceType.IPFS, context);
  }

  /**
   * Convert webhook errors
   */
  static convertWebhookError(error: unknown, context?: string): AppError {
    return this.convertToAppError(error, ServiceType.WEBHOOK, context);
  }
}
