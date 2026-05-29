import { ApiError } from "./api/client";
import { ToastType } from "@/types/toast";

/**
 * Backend error codes from the API
 */
export enum BackendErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
  DOMAIN_ERROR = "DOMAIN_ERROR",
  INFRA_ERROR = "INFRA_ERROR",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  TRADE_NOT_FOUND = "TRADE_NOT_FOUND",
  TRADE_ACCESS_DENIED = "TRADE_ACCESS_DENIED",
  TRADE_INVALID_STATUS = "TRADE_INVALID_STATUS",
  TRADE_BUILD_FAILED = "TRADE_BUILD_FAILED",
  DISPUTE_INVALID_CATEGORY = "DISPUTE_INVALID_CATEGORY",
  DISPUTE_STATUS_TRANSITION_INVALID = "DISPUTE_STATUS_TRANSITION_INVALID",
  DISPUTE_STATUS_CONFLICT = "DISPUTE_STATUS_CONFLICT",
  DISPUTE_NOT_FOUND = "DISPUTE_NOT_FOUND",
  PAYMENT_PROVIDER_ERROR = "PAYMENT_PROVIDER_ERROR",
  PAYMENT_PROVIDER_TIMEOUT = "PAYMENT_PROVIDER_TIMEOUT",
  PAYMENT_INSUFFICIENT_FUNDS = "PAYMENT_INSUFFICIENT_FUNDS",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
}

/**
 * Backend error response structure
 */
export interface BackendErrorResponse {
  code: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  path?: string;
  requestId?: string;
  correlationId?: string;
}

/**
 * User-friendly error message mapping
 */
const ERROR_MESSAGE_MAP: Record<string, { title: string; message: string; type: ToastType }> = {
  [BackendErrorCode.VALIDATION_ERROR]: {
    title: "Invalid Input",
    message: "Please check your input and try again.",
    type: "warning",
  },
  [BackendErrorCode.AUTH_ERROR]: {
    title: "Authentication Failed",
    message: "Please log in again to continue.",
    type: "error",
  },
  [BackendErrorCode.DOMAIN_ERROR]: {
    title: "Operation Not Allowed",
    message: "This operation is not allowed in the current state.",
    type: "error",
  },
  [BackendErrorCode.INFRA_ERROR]: {
    title: "Service Unavailable",
    message: "Our service is temporarily unavailable. Please try again later.",
    type: "error",
  },
  [BackendErrorCode.NOT_FOUND]: {
    title: "Not Found",
    message: "The requested resource was not found.",
    type: "warning",
  },
  [BackendErrorCode.INTERNAL_ERROR]: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    type: "error",
  },
  [BackendErrorCode.TRADE_NOT_FOUND]: {
    title: "Trade Not Found",
    message: "The trade you're looking for doesn't exist or has been removed.",
    type: "warning",
  },
  [BackendErrorCode.TRADE_ACCESS_DENIED]: {
    title: "Access Denied",
    message: "You don't have permission to access this trade.",
    type: "error",
  },
  [BackendErrorCode.TRADE_INVALID_STATUS]: {
    title: "Invalid Trade Status",
    message: "This operation cannot be performed on the current trade status.",
    type: "warning",
  },
  [BackendErrorCode.TRADE_BUILD_FAILED]: {
    title: "Trade Creation Failed",
    message: "Failed to create the trade. Please try again.",
    type: "error",
  },
  [BackendErrorCode.DISPUTE_INVALID_CATEGORY]: {
    title: "Invalid Dispute Category",
    message: "Please select a valid dispute category.",
    type: "warning",
  },
  [BackendErrorCode.DISPUTE_STATUS_TRANSITION_INVALID]: {
    title: "Invalid Dispute Status",
    message: "This dispute status transition is not allowed.",
    type: "error",
  },
  [BackendErrorCode.DISPUTE_STATUS_CONFLICT]: {
    title: "Dispute Conflict",
    message: "This dispute has been modified by another user. Please refresh.",
    type: "warning",
  },
  [BackendErrorCode.DISPUTE_NOT_FOUND]: {
    title: "Dispute Not Found",
    message: "The dispute you're looking for doesn't exist.",
    type: "warning",
  },
  [BackendErrorCode.PAYMENT_PROVIDER_ERROR]: {
    title: "Payment Error",
    message: "There was an error processing the payment. Please try again.",
    type: "error",
  },
  [BackendErrorCode.PAYMENT_PROVIDER_TIMEOUT]: {
    title: "Payment Timeout",
    message: "The payment request timed out. Please try again.",
    type: "warning",
  },
  [BackendErrorCode.PAYMENT_INSUFFICIENT_FUNDS]: {
    title: "Insufficient Funds",
    message: "You don't have enough funds to complete this transaction.",
    type: "error",
  },
  [BackendErrorCode.RATE_LIMIT_EXCEEDED]: {
    title: "Too Many Requests",
    message: "Please wait a moment before trying again.",
    type: "warning",
  },
};

/**
 * HTTP status code to toast type mapping
 */
const STATUS_CODE_MAP: Record<number, ToastType> = {
  400: "warning",
  401: "error",
  403: "error",
  404: "warning",
  429: "warning",
  500: "error",
  502: "error",
  503: "error",
  504: "warning",
};

/**
 * Parse backend error from ApiError
 */
export function parseBackendError(error: ApiError): BackendErrorResponse | null {
  if (typeof error.data === "object" && error.data !== null) {
    const data = error.data as BackendErrorResponse;
    if (data.code && data.message) {
      return data;
    }
  }
  return null;
}

/**
 * Get user-friendly error information from an ApiError
 */
export function getErrorInfo(error: ApiError | Error): {
  title: string;
  message: string;
  type: ToastType;
} {
  // Handle ApiError with backend error response
  if (error instanceof ApiError) {
    const backendError = parseBackendError(error);
    
    if (backendError && backendError.code in ERROR_MESSAGE_MAP) {
      const mapped = ERROR_MESSAGE_MAP[backendError.code];
      return {
        title: mapped.title,
        message: backendError.message || mapped.message,
        type: mapped.type,
      };
    }

    // Fallback to HTTP status code mapping
    const type = STATUS_CODE_MAP[error.status] || "error";
    return {
      title: error.status === 0 ? "Network Error" : `Error ${error.status}`,
      message: error.message || "An unexpected error occurred",
      type,
    };
  }

  // Handle generic errors
  return {
    title: "Error",
    message: error.message || "An unexpected error occurred",
    type: "error",
  };
}

/**
 * Check if an error is a network error
 */
export function isNetworkError(error: ApiError | Error): boolean {
  if (error instanceof ApiError) {
    return error.status === 0;
  }
  const message = error.message?.toLowerCase() || "";
  return (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout")
  );
}

/**
 * Check if an error is an authentication error
 */
export function isAuthError(error: ApiError | Error): boolean {
  if (error instanceof ApiError) {
    const backendError = parseBackendError(error);
    if (backendError) {
      return (
        backendError.code === BackendErrorCode.AUTH_ERROR ||
        backendError.code === BackendErrorCode.TRADE_ACCESS_DENIED
      );
    }
    return error.status === 401 || error.status === 403;
  }
  return false;
}

/**
 * Check if an error is a validation error
 */
export function isValidationError(error: ApiError | Error): boolean {
  if (error instanceof ApiError) {
    const backendError = parseBackendError(error);
    if (backendError) {
      return backendError.code === BackendErrorCode.VALIDATION_ERROR;
    }
    return error.status === 400;
  }
  return false;
}

/**
 * Check if an error is a not found error
 */
export function isNotFoundError(error: ApiError | Error): boolean {
  if (error instanceof ApiError) {
    const backendError = parseBackendError(error);
    if (backendError) {
      return backendError.code === BackendErrorCode.NOT_FOUND;
    }
    return error.status === 404;
  }
  return false;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: ApiError | Error): boolean {
  if (error instanceof ApiError) {
    const backendError = parseBackendError(error);
    if (backendError) {
      return (
        backendError.code === BackendErrorCode.PAYMENT_PROVIDER_TIMEOUT ||
        backendError.code === BackendErrorCode.INFRA_ERROR ||
        backendError.code === BackendErrorCode.RATE_LIMIT_EXCEEDED
      );
    }
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  return isNetworkError(error);
}
