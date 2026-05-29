import { Request } from 'express';
import { AppError, ErrorCode } from '../errors/errorCodes';
import { ServiceErrorConverter, ServiceType } from '../errors/serviceErrorConverter';

/**
 * Authentication header parsing result
 */
export interface AuthHeaderResult {
  valid: boolean;
  token?: string;
  error?: AppError;
}

/**
 * Authentication error types for better classification
 */
export enum AuthErrorType {
  MISSING_HEADER = 'missing_header',
  INVALID_FORMAT = 'invalid_format',
  INVALID_TOKEN = 'invalid_token',
  EXPIRED_TOKEN = 'expired_token',
  NETWORK_ERROR = 'network_error',
  CONFIG_ERROR = 'config_error',
}

/**
 * Centralized authentication helper utilities
 * Improves token/header assembly and error classification
 */
export class AuthHelper {
  /**
   * Extract and validate Authorization header
   * Returns structured result with proper error classification
   */
  static extractAuthHeader(req: Request): AuthHeaderResult {
    const authHeader = req.headers.authorization;

    // Missing header
    if (!authHeader) {
      return {
        valid: false,
        error: new AppError(
          ErrorCode.AUTH_ERROR,
          'Missing Authorization header',
          401,
          { errorType: AuthErrorType.MISSING_HEADER }
        ),
      };
    }

    // Invalid format (not Bearer)
    if (!authHeader.startsWith('Bearer ')) {
      return {
        valid: false,
        error: new AppError(
          ErrorCode.AUTH_ERROR,
          'Invalid Authorization header format. Expected: Bearer <token>',
          401,
          { errorType: AuthErrorType.INVALID_FORMAT }
        ),
      };
    }

    // Extract token
    const token = authHeader.split(' ')[1];
    
    // Empty token
    if (!token || token.trim() === '') {
      return {
        valid: false,
        error: new AppError(
          ErrorCode.AUTH_ERROR,
          'Empty token in Authorization header',
          401,
          { errorType: AuthErrorType.INVALID_FORMAT }
        ),
      };
    }

    return {
      valid: true,
      token,
    };
  }

  /**
   * Classify authentication errors to prevent misclassification as network errors
   */
  static classifyAuthError(error: unknown): AppError {
    // If already an AppError, return as-is
    if (error instanceof AppError) {
      return error;
    }

    // Handle structured AppError across boundaries
    if (this.isAppErrorStructural(error)) {
      return error as AppError;
    }

    const err = error as Error;

    // JWT-specific errors
    if (err.name === 'TokenExpiredError') {
      return new AppError(
        ErrorCode.AUTH_ERROR,
        'Token expired',
        401,
        { errorType: AuthErrorType.EXPIRED_TOKEN, originalError: err.message }
      );
    }

    if (err.name === 'JsonWebTokenError') {
      return new AppError(
        ErrorCode.AUTH_ERROR,
        'Invalid token',
        401,
        { errorType: AuthErrorType.INVALID_TOKEN, originalError: err.message }
      );
    }

    if (err.name === 'NotBeforeError') {
      return new AppError(
        ErrorCode.AUTH_ERROR,
        'Token not yet valid',
        401,
        { errorType: AuthErrorType.INVALID_TOKEN, originalError: err.message }
      );
    }

    // Network/infrastructure errors - use service error converter
    if (this.isNetworkError(err)) {
      return ServiceErrorConverter.convertToAppError(
        error,
        ServiceType.REDIS,
        'auth_service'
      );
    }

    // Configuration errors
    if (err.message?.includes('JWT_SECRET') || err.message?.includes('not set')) {
      return new AppError(
        ErrorCode.INFRA_ERROR,
        'Authentication service configuration error',
        500,
        { errorType: AuthErrorType.CONFIG_ERROR, originalError: err.message }
      );
    }

    // Generic auth error (not network)
    return new AppError(
      ErrorCode.AUTH_ERROR,
      'Authentication failed',
      401,
      { errorType: AuthErrorType.INVALID_TOKEN, originalError: err.message }
    );
  }

  /**
   * Check if error is a network error
   */
  private static isNetworkError(error: Error): boolean {
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout') ||
      message.includes('connection reset') ||
      message.includes('connection refused') ||
      message.includes('redis') ||
      message.includes('timeout')
    );
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
   * Validate token format before attempting verification
   * Prevents network errors from being misclassified as auth errors
   */
  static validateTokenFormat(token: string): { valid: boolean; error?: AppError } {
    if (!token || typeof token !== 'string') {
      return {
        valid: false,
        error: new AppError(
          ErrorCode.AUTH_ERROR,
          'Invalid token: not a string',
          401,
          { errorType: AuthErrorType.INVALID_TOKEN }
        ),
      };
    }

    // JWT tokens should have 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) {
      return {
        valid: false,
        error: new AppError(
          ErrorCode.AUTH_ERROR,
          'Invalid token format: expected JWT with 3 parts',
          401,
          { errorType: AuthErrorType.INVALID_TOKEN }
        ),
      };
    }

    // Check each part is non-empty
    if (parts.some(part => part.length === 0)) {
      return {
        valid: false,
        error: new AppError(
          ErrorCode.AUTH_ERROR,
          'Invalid token format: empty token part',
          401,
          { errorType: AuthErrorType.INVALID_TOKEN }
        ),
      };
    }

    return { valid: true };
  }

  /**
   * Complete authentication flow with proper error classification
   */
  static async authenticateRequest(
    req: Request,
    validateFn: (token: string) => Promise<any>
  ): Promise<{ user: any; error?: AppError }> {
    // Extract and validate header
    const headerResult = this.extractAuthHeader(req);
    if (!headerResult.valid) {
      return { user: null, error: headerResult.error };
    }

    // Validate token format
    const formatResult = this.validateTokenFormat(headerResult.token!);
    if (!formatResult.valid) {
      return { user: null, error: formatResult.error };
    }

    try {
      const user = await validateFn(headerResult.token!);
      return { user };
    } catch (error) {
      const classifiedError = this.classifyAuthError(error);
      return { user: null, error: classifiedError };
    }
  }
}
