"use client";

import React from "react";
import { icons, LucideProps } from "lucide-react";

// Size map: xs=12, sm=16, md=20, lg=24
const SIZE_MAP = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export interface IconProps {
  name: string;
  size?: keyof typeof SIZE_MAP;
  className?: string;
  "aria-label"?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = "sm",
  className = "",
  "aria-label": ariaLabel,
  strokeWidth = 1.8,
}: IconProps) {
  // Normalise name: "arrow-left" → "ArrowLeft"
  const pascalName = name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") as keyof typeof icons;

  const LucideIcon = icons[pascalName] as
    | React.ComponentType<LucideProps>
    | undefined;

  if (!LucideIcon) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[Icon] Unknown icon: "${name}" (looked up as "${pascalName}")`);
    }
    // Render a neutral fallback square so layout never breaks
    return (
      <span
        role="img"
        aria-label={ariaLabel ?? name}
        className={`inline-block rounded-sm bg-current opacity-20 ${className}`}
        style={{ width: SIZE_MAP[size], height: SIZE_MAP[size] }}
      />
    );
  }

  return (
    <LucideIcon
      size={SIZE_MAP[size]}
      strokeWidth={strokeWidth}
      className={`shrink-0 ${className || "text-text-secondary"}`}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
      role={ariaLabel ? "img" : undefined}
    />
  );
}
