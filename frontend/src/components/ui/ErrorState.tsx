"use client";

import * as React from "react";
import { clsx } from "clsx";

export interface ErrorStateProps {
  title?: string;
  message?: string;
  variant?: "default" | "inline" | "card";
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message = "An unexpected error occurred. Please try again.",
  variant = "default",
  onRetry,
  className,
}: ErrorStateProps) {
  if (variant === "inline") {
    return (
      <div
        className={clsx("flex items-center gap-2 text-sm text-danger", className)}
        role="alert"
      >
        <svg
          className="h-4 w-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="font-medium hover:underline"
            aria-label="Retry"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (variant === "card") {
    const CardIcon = () => (
      <div className="mx-auto h-12 w-12 rounded-full bg-danger/10 flex items-center justify-center">
        <svg
          className="h-6 w-6 text-danger"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
    );

    return (
      <div
        className={clsx(
          "flex flex-col items-center justify-center gap-4 p-8 text-center",
          className,
        )}
        role="alert"
      >
        <CardIcon />
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-content">{title}</h2>
          <p className="text-sm text-muted">{message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className={clsx(
              "mt-2 rounded-lg px-4 py-2 text-sm font-medium",
              "bg-danger text-white hover:bg-danger/90",
              "transition-colors focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2",
            )}
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-2", className)} role="alert">
      <h2 className="text-lg font-semibold text-danger">{title}</h2>
      <p className="text-sm text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className={clsx(
            "self-start rounded-lg px-4 py-2 text-sm font-medium",
            "bg-danger text-white hover:bg-danger/90",
            "transition-colors focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2",
          )}
        >
          Try again
        </button>
      )}
    </div>
  );
}