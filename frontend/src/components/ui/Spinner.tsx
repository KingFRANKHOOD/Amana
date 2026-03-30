import * as React from "react";
import { clsx } from "clsx";

const SIZE_CLASSES = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  "aria-label"?: string;
}

export function Spinner({
  size = "md",
  className,
  "aria-label": ariaLabel = "Loading",
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={clsx(
        "inline-block rounded-full border-2 border-transparent border-t-gold",
        "animate-spin motion-reduce:animate-none",
        SIZE_CLASSES[size],
        className,
      )}
    />
  );
}
