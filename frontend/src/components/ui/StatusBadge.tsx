"use client";

import React from "react";
import {
  CheckCircle,
  Truck,
  AlertTriangle,
  Lock,
  FileText,
  Clock,
  LucideProps,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

export type TradeStatus =
  | "delivered"
  | "in-transit"
  | "disputed"
  | "locked"
  | "draft"
  | "pending";

export interface StatusBadgeProps {
  status: TradeStatus;
  size?: "sm" | "md";
  showIcon?: boolean;
}

// ── Status config map ────────────────────────────────────────────

interface StatusConfig {
  label: string;
  icon: React.ComponentType<LucideProps>;
  dot: string;       // dot background color
  badge: string;     // badge bg + text + border
}

const STATUS_MAP: Record<TradeStatus, StatusConfig> = {
  delivered: {
    label: "Delivered",
    icon: CheckCircle,
    dot: "bg-status-success",
    badge:
      "bg-status-success/10 text-status-success border-status-success/25",
  },
  "in-transit": {
    label: "In Transit",
    icon: Truck,
    dot: "bg-status-warning",
    badge:
      "bg-status-warning/10 text-status-warning border-status-warning/25",
  },
  disputed: {
    label: "Disputed",
    icon: AlertTriangle,
    dot: "bg-status-danger",
    badge:
      "bg-status-danger/10 text-status-danger border-status-danger/25",
  },
  locked: {
    label: "Funds Locked",
    icon: Lock,
    dot: "bg-status-locked",
    badge:
      "bg-status-locked/10 text-status-locked border-status-locked/25",
  },
  draft: {
    label: "Draft",
    icon: FileText,
    dot: "bg-status-draft",
    badge:
      "bg-status-draft/10 text-status-draft border-status-draft/25",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    dot: "bg-status-info",
    badge:
      "bg-status-info/10 text-status-info border-status-info/25",
  },
};

// ── Size config ──────────────────────────────────────────────────

const SIZE_MAP = {
  sm: {
    badge: "px-2 py-0.5 text-xs gap-1.5",
    icon: 11,
    dot: "w-1.5 h-1.5",
  },
  md: {
    badge: "px-2.5 py-1 text-sm gap-2",
    icon: 13,
    dot: "w-2 h-2",
  },
};

// ── Component ────────────────────────────────────────────────────

export function StatusBadge({
  status,
  size = "md",
  showIcon = true,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status];
  const sizeConfig = SIZE_MAP[size];
  const IconComponent = config.icon;

  return (
    <span
      className={`
        inline-flex items-center font-semibold rounded-full border
        ${sizeConfig.badge}
        ${config.badge}
      `}
    >
      {showIcon ? (
        <IconComponent
          size={sizeConfig.icon}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0"
        />
      ) : (
        /* Dot when icon is hidden */
        <span
          className={`rounded-full shrink-0 ${sizeConfig.dot} ${config.dot}`}
          aria-hidden="true"
        />
      )}
      {config.label}
    </span>
  );
}
