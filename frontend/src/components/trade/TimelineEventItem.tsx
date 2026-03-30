"use client";

import React from "react";
import type { TransactionEvent, TransactionEventStatus } from "@/types/trade";

interface TimelineEventItemProps {
  event: TransactionEvent;
  status: TransactionEventStatus;
  isLast: boolean;
}

const ACTOR_LABELS: Record<TransactionEvent["actor"], string> = {
  system: "System",
  buyer: "Buyer",
  seller: "Seller",
  driver: "Driver",
};

const ACTOR_COLORS: Record<TransactionEvent["actor"], string> = {
  system: "text-status-info",
  buyer: "text-emerald",
  seller: "text-gold",
  driver: "text-teal",
};

function StatusIcon({ status }: { status: TransactionEventStatus }) {
  if (status === "completed") {
    return (
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 7l3 3 6-6" />
      </svg>
    );
  }

  if (status === "active") {
    return <span className="w-2 h-2 rounded-full bg-current block" />;
  }

  return <span className="w-2 h-2 rounded-full bg-current/30 block" />;
}

const NODE_STYLES: Record<TransactionEventStatus, string> = {
  completed: "bg-emerald text-text-inverse border-emerald",
  active:
    "bg-status-warning text-text-inverse border-status-warning ring-4 ring-status-warning/20",
  pending: "bg-elevated text-text-muted border-border-default",
};

export function TimelineEventItem({
  event,
  status,
  isLast,
}: TimelineEventItemProps) {
  const isActive = status === "active";
  const isPending = status === "pending";

  return (
    <div className="relative flex gap-3 group">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[17px] top-9 bottom-0 w-px bg-border-default" />
      )}

      {/* Status node */}
      <div
        className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border transition-all duration-200 ${NODE_STYLES[status]}`}
      >
        <StatusIcon status={status} />
      </div>

      {/* Content */}
      <div className={`flex-1 pb-6 ${isLast ? "pb-0" : ""}`}>
        <div className="flex items-start justify-between gap-2 pt-1.5 mb-0.5">
          <p
            className={`text-sm font-semibold leading-tight ${
              isPending ? "text-text-muted" : "text-text-primary"
            }`}
          >
            {event.title}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning border border-status-warning/20 font-semibold tracking-wide uppercase">
                Active
              </span>
            )}
            {event.timestamp && (
              <span className="text-[11px] text-text-muted whitespace-nowrap">
                {event.timestamp}
              </span>
            )}
          </div>
        </div>

        <span
          className={`text-[11px] font-medium uppercase tracking-wide ${ACTOR_COLORS[event.actor]}`}
        >
          {ACTOR_LABELS[event.actor]}
        </span>

        {event.description && (
          <p className="text-xs text-text-secondary leading-relaxed mt-1">
            {event.description}
          </p>
        )}
      </div>
    </div>
  );
}
