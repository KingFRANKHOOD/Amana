import React from "react";
import { Skeleton } from "./Skeleton";

interface SkeletonListProps {
  /** Number of list rows to render */
  rows?: number;
  /** Number of columns per row */
  columns?: number;
  className?: string;
}

/**
 * Skeleton placeholder that matches a table / list layout.
 */
export function SkeletonList({
  rows = 5,
  columns = 5,
  className = "",
}: SkeletonListProps) {
  return (
    <div
      className={`rounded-lg border border-border-default overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {/* Header row */}
      <div className="flex gap-4 px-4 py-3 border-b border-border-default bg-bg-card">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className={`flex gap-4 px-4 py-3 border-b border-border-default last:border-0 ${
            rowIdx % 2 === 0 ? "bg-bg-primary" : "bg-bg-card"
          }`}
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={`h-3 flex-1 ${colIdx === 0 ? "max-w-[80px]" : ""}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
