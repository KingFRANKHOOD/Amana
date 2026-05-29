import { useCallback } from "react";
import { useToast } from "./useToast";
import { ApiError } from "@/lib/api/client";
import { getErrorInfo, isAuthError, isNetworkError, isRetryableError } from "@/lib/errorHandler";

/**
 * Hook for handling API errors with consistent toast notifications
 * Provides automatic error classification and user-friendly messages
 */
export function useErrorHandler() {
  const { addToast } = useToast();

  const handleError = useCallback(
    (error: unknown, options?: { showToast?: boolean; customMessage?: string }) => {
      const { showToast = true, customMessage } = options || {};

      let apiError: ApiError;

      // Convert to ApiError if needed
      if (error instanceof ApiError) {
        apiError = error;
      } else if (error instanceof Error) {
        apiError = new ApiError(0, error.message, error);
      } else {
        apiError = new ApiError(0, "An unexpected error occurred", error);
      }

      // Get user-friendly error information
      const errorInfo = getErrorInfo(apiError);

      // Show toast notification
      if (showToast) {
        addToast({
          type: errorInfo.type,
          title: errorInfo.title,
          message: customMessage || errorInfo.message,
          duration: errorInfo.type === "error" ? 6000 : 4000,
        });
      }

      // Log error for debugging
      if (process.env.NODE_ENV === "development") {
        console.error("[useErrorHandler]", {
          error: apiError,
          backendError: apiError.backendError,
          errorInfo,
        });
      }

      return apiError;
    },
    [addToast]
  );

  const handleAuthError = useCallback(
    (error: unknown) => {
      if (isAuthError(error)) {
        handleError(error, {
          customMessage: "Your session has expired. Please log in again.",
        });
        return true;
      }
      return false;
    },
    [handleError]
  );

  const handleNetworkError = useCallback(
    (error: unknown) => {
      if (isNetworkError(error)) {
        handleError(error, {
          customMessage: "Network connection failed. Please check your internet connection.",
        });
        return true;
      }
      return false;
    },
    [handleError]
  );

  const handleRetryableError = useCallback(
    (error: unknown, retryFn?: () => void) => {
      if (isRetryableError(error)) {
        handleError(error, {
          customMessage: retryFn
            ? "Temporary error. Retrying..."
            : "A temporary error occurred. Please try again.",
        });

        if (retryFn) {
          // Exponential backoff retry
          setTimeout(() => {
            retryFn();
          }, 1000);
        }

        return true;
      }
      return false;
    },
    [handleError]
  );

  return {
    handleError,
    handleAuthError,
    handleNetworkError,
    handleRetryableError,
  };
}
