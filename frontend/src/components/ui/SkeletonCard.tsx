import React from "react";
import { Skeleton } from "./Skeleton";

interface SkeletonCardProps {
  /** Number of text lines to show inside the card */
  lines?: number;
  className?: string;
}

/**
 * Skeleton placeholder that matches a card layout.
 */
export function SkeletonCard({ lines = 3, className = "" }: SkeletonCardProps) {
  return (
    <div
      className={`rounded-xl border border-border-default bg-bg-card p-6 shadow-card ${className}`}
      aria-hidden="true"
    >
      {/* Header row */}
      <Skeleton className="h-4 w-1/3 mb-4" />
      {/* Body lines */}
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 mb-2 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}
