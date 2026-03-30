import * as React from "react";
import { clsx } from "clsx";

interface SkeletonLineProps {
  width?: string;
  height?: string;
  className?: string;
}

function SkeletonLine({
  width = "w-full",
  height = "h-4",
  className,
}: SkeletonLineProps) {
  return (
    <div
      className={clsx(
        "rounded-md bg-elevated text-transparent",
        "animate-pulse motion-reduce:animate-none",
        width,
        height,
        className,
      )}
    />
  );
}

export interface LoadingStateProps {
  variant?: "card" | "row" | "inline";
  rows?: number;
  className?: string;
}

export function LoadingState({
  variant = "card",
  rows = 3,
  className,
}: LoadingStateProps) {
  if (variant === "inline") {
    return (
      <div
        className={clsx("flex flex-col gap-2", className)}
        aria-busy="true"
        aria-label="Loading"
      >
        <SkeletonLine width="w-3/4" height="h-4" />
        <SkeletonLine width="w-1/2" height="h-3" />
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div
        className={clsx(
          "flex items-center gap-3 p-3 rounded-lg border border-border-default",
          className,
        )}
        aria-busy="true"
        aria-label="Loading"
      >
        <div className="h-9 w-9 rounded-md bg-elevated animate-pulse motion-reduce:animate-none flex-shrink-0" />
        <div className="flex flex-col gap-2 flex-1">
          <SkeletonLine width="w-1/2" height="h-3" />
          <SkeletonLine width="w-3/4" height="h-3" />
        </div>
        <SkeletonLine
          width="w-16"
          height="h-6"
          className="rounded-full flex-shrink-0"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "bg-card rounded-xl border border-border-default p-6 shadow-card",
        className,
      )}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="h-8 w-8 rounded-md bg-elevated animate-pulse motion-reduce:animate-none" />
        <SkeletonLine width="w-32" height="h-4" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i % 3 === 2 ? "w-2/3" : i % 3 === 1 ? "w-5/6" : "w-full"}
            height="h-4"
          />
        ))}
      </div>

      <div className="mt-6 h-10 w-full rounded-lg bg-elevated animate-pulse motion-reduce:animate-none" />
    </div>
  );
}
