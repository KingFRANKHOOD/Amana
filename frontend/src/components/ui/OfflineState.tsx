"use client";

import * as React from "react";
import { clsx } from "clsx";

export interface OfflineStateProps {
  onRetry?: () => void;
  className?: string;
}

export function OfflineState({
  onRetry,
  className,
}: OfflineStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-4 p-8 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center">
        <svg
          className="h-6 w-6 text-warning"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
          />
        </svg>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-content">You're offline</h2>
        <p className="text-sm text-muted">
          Please check your internet connection and try again.
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className={clsx(
            "mt-2 rounded-lg px-4 py-2 text-sm font-medium",
            "bg-warning text-white hover:bg-warning/90",
            "transition-colors focus:outline-none focus:ring-2 focus:ring-warning focus:ring-offset-2",
          )}
        >
          Retry connection
        </button>
      )}
    </div>
  );
}