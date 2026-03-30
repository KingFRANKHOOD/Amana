"use client";

import React from "react";
import type { TransactionEvent, TransactionEventStatus } from "@/types/trade";
import { TimelineEventItem } from "./TimelineEventItem";

interface TransactionTimelineProps {
  events: TransactionEvent[];
  currentEventIndex: number;
}

function resolveStatus(
  index: number,
  currentEventIndex: number,
): TransactionEventStatus {
  if (index < currentEventIndex) return "completed";
  if (index === currentEventIndex) return "active";
  return "pending";
}

export function TransactionTimeline({
  events,
  currentEventIndex,
}: TransactionTimelineProps) {
  return (
    <div className="bg-card rounded-xl border border-border-default p-6 shadow-card flex flex-col flex-1">
      <div className="flex items-center gap-2 mb-5">
        <svg
          className="w-4 h-4 text-gold"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="text-sm font-semibold text-text-secondary tracking-wide uppercase">
          Transaction Timeline
        </h2>
      </div>

      <div className="flex flex-col flex-1 relative">
        {events.map((event, index) => (
          <TimelineEventItem
            key={event.id}
            event={event}
            status={resolveStatus(index, currentEventIndex)}
            isLast={index === events.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
