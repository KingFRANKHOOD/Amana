import React from "react";

interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton block with shimmer animation.
 * Uses design tokens for consistent bg color.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-bg-elevated ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}
