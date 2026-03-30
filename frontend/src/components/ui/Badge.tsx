"use client";

import React from "react";

export interface BadgeProps {
  variant?: "success" | "warning" | "danger" | "locked" | "draft" | "info" | "neutral";
  size?: "sm" | "md";
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  success: {
    bg: "bg-emerald-muted",
    text: "text-emerald",
    dot: "bg-emerald",
  },
  warning: {
    bg: "bg-status-warning/15",
    text: "text-status-warning",
    dot: "bg-status-warning",
  },
  danger: {
    bg: "bg-status-danger/15",
    text: "text-status-danger",
    dot: "bg-status-danger",
  },
  locked: {
    bg: "bg-gold-muted",
    text: "text-gold",
    dot: "bg-gold",
  },
  draft: {
    bg: "bg-status-draft/15",
    text: "text-status-draft",
    dot: "bg-status-draft",
  },
  info: {
    bg: "bg-status-info/15",
    text: "text-status-info",
    dot: "bg-status-info",
  },
  neutral: {
    bg: "bg-border-default",
    text: "text-text-secondary",
    dot: "bg-text-secondary",
  },
};

const sizeStyles = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1 text-xs",
};

export function Badge({
  variant = "neutral",
  size = "md",
  dot = false,
  children,
  className = "",
}: BadgeProps) {
  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-semibold tracking-wide ${variantStyle.bg} ${variantStyle.text} ${sizeStyle} ${className}`}
      role="status"
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${variantStyle.dot}`} />}
      {children}
    </span>
  );
}
