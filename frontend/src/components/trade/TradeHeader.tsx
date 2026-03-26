"use client";

import React from "react";
import { FileText } from "lucide-react";
import type { TradeDetail } from "@/types/trade";

interface TradeHeaderProps {
  trade: TradeDetail;
}

const STATUS_STYLES: Record<string, string> = {
  "IN TRANSIT":
    "bg-emerald-muted text-emerald border border-emerald/30",
  "PENDING":
    "bg-status-warning/10 text-status-warning border border-status-warning/30",
  "SETTLED":
    "bg-status-info/10 text-status-info border border-status-info/30",
  "DISPUTED":
    "bg-status-danger/10 text-status-danger border border-status-danger/30",
  "DRAFT":
    "bg-status-draft/10 text-status-draft border border-status-draft/30",
};

export function TradeHeader({ trade }: TradeHeaderProps) {
  const statusStyle =
    STATUS_STYLES[trade.status] ?? STATUS_STYLES["DRAFT"];

  return (
    <div className="bg-card rounded-xl border border-border-default p-6 shadow-card">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-text-muted mb-4">
        <span className="hover:text-text-secondary cursor-pointer transition-colors">
          Trades
        </span>
        <span>/</span>
        <span className="text-text-secondary">{trade.id}</span>
      </div>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gold leading-tight">
            {trade.quantity} {trade.commodity}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {/* Status badge */}
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${statusStyle}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              {trade.status}
            </span>

            {/* Initiated date */}
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="1" y="2" width="14" height="13" rx="2" />
                <path d="M1 6h14M5 1v2M11 1v2" />
              </svg>
              Initiated {trade.initiatedAt}
            </span>

            {/* Commodity category tag */}
            <span className="px-2.5 py-0.5 rounded-md bg-gold-muted text-gold text-xs font-medium border border-gold/20">
              {trade.category}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 flex-shrink-0">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border-default text-text-secondary text-sm font-medium hover:border-border-hover hover:text-text-primary transition-all">
            <FileText className="w-4 h-4" />
            View Contract
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-gold-cta text-text-inverse text-sm font-semibold hover:shadow-glow-gold transition-all">
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="8" cy="8" r="7" />
              <path d="M5 8l2.5 2.5L11 5.5" />
            </svg>
            Confirm Delivery
          </button>
        </div>
      </div>
    </div>
  );
}
