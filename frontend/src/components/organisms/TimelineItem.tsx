"use client";

import React from "react";

export type TimelineItemStatus = "completed" | "active" | "pending";

export type TimelineItemActor = "Buyer" | "Seller" | "System";

export interface TimelineItemProps {
  event: string;
  timestamp: string;
  status: TimelineItemStatus;
  detail?: string;
  actor?: TimelineItemActor;
  isLast?: boolean;
}

function formatTimelineTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function StatusMarker({ status }: { status: TimelineItemStatus }) {
  if (status === "completed") {
    return (
      <div className="flex h-3 w-3 shrink-0 items-center justify-center">
        <div className="h-2 w-2 shrink-0 rounded-full bg-accent-emerald" />
      </div>
    );
  }

  if (status === "active") {
    return (
      <div className="h-3 w-3 shrink-0 rounded-full bg-gold animate-pulse" />
    );
  }

  return (
    <div
      className="h-3 w-3 shrink-0 rounded-full border-2 border-border-default bg-transparent"
      aria-hidden
    />
  );
}

export function TimelineItem({
  event,
  timestamp,
  status,
  detail,
  actor,
  isLast = false,
}: TimelineItemProps) {
  const titleClass =
    status === "active"
      ? "font-semibold text-text-primary"
      : status === "pending"
        ? "text-text-muted"
        : "text-text-primary";

  return (
    <div className="relative flex gap-3">
      <div className="relative w-3 shrink-0">
        {!isLast ? (
          <div
            className="absolute top-3 left-1.5 w-0.5 min-h-[40px] bg-border-default"
            aria-hidden
          />
        ) : null}
        <div className="relative z-10 flex justify-center pt-0.5">
          <StatusMarker status={status} />
        </div>
      </div>

      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-6"}`}>
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm leading-tight ${titleClass}`}>{event}</p>
          <time
            className="shrink-0 text-xs text-text-muted"
            dateTime={timestamp}
          >
            {formatTimelineTimestamp(timestamp)}
          </time>
        </div>

        {actor ? (
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            {actor}
          </p>
        ) : null}

        {detail ? (
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
