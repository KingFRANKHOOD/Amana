"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics } from "@/components/AnalyticsProvider";
import { api, ApiError, TradeResponse } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";

type TradeStatus = "all" | "active" | "pending" | "completed" | "disputed";

const FILTERS: { label: string; value: TradeStatus }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Completed", value: "completed" },
  { label: "Disputed", value: "disputed" },
];

const NAV_ITEM_BASE =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2";
const NAV_ITEM_ACTIVE = "bg-surface-2 text-gold shadow-elev-1";
const NAV_ITEM_INACTIVE = "text-text-secondary hover:text-text-primary hover:bg-surface-2/60";

// Status chip tokens: text = status color, bg = status/10, border = status/20.
// "completed" and "draft" use neutral surface tokens (no alert color).
const STATUS_STYLES: Record<string, string> = {
  active:    "text-status-success bg-status-success/10 border border-status-success/20",
  pending:   "text-status-warning bg-status-warning/10 border border-status-warning/20",
  completed: "text-text-secondary bg-surface-2 border border-border-default",
  disputed:  "text-status-danger  bg-status-danger/10  border border-status-danger/20",
  locked:    "text-status-locked  bg-status-locked/10  border border-status-locked/20",
  draft:     "text-status-draft   bg-surface-1         border border-border-default",
};

const PAGE_SIZE = 10;

function TradesTableSkeleton() {
  return (
    <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
      {/* Header: surface-1 (card level) */}
      <div className="border-b border-border-default bg-surface-1 px-4 py-3">
        <div className="grid grid-cols-5 gap-4">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      {/* Rows: surface-0 (canvas) */}
      <div className="divide-y divide-border-default bg-surface-0">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="grid grid-cols-5 gap-4 px-4 py-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TradesPage() {
  const { token, isAuthenticated } = useAuth();
  const { trackApiFailure, trackFunnelStep } = useAnalytics();
  const [activeFilter, setActiveFilter] = useState<TradeStatus>("all");
  const [page, setPage] = useState(1);
  const [trades, setTrades] = useState<TradeResponse[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackFunnelStep("trade_page_view", { filter: activeFilter });

    async function fetchTrades() {
      if (!isAuthenticated || !token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const statusParam = activeFilter === "all" ? undefined : activeFilter;
        const response = await api.trades.list(token, {
          status: statusParam,
          page,
          limit: PAGE_SIZE,
        });

        setTrades(response.items);
        setTotalPages(response.pagination.totalPages);
      } catch (err) {
        let errorMessage = "Failed to load trades";
        let status = 0;

        if (err instanceof ApiError) {
          errorMessage = err.message;
          status = err.status ?? 0;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }

        trackApiFailure("/trades", status, { message: errorMessage, filter: activeFilter });
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    fetchTrades();
  }, [token, isAuthenticated, activeFilter, page]);

  function handleFilter(value: TradeStatus) {
    setActiveFilter(value);
    setPage(1);
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatAddress(address: string) {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/*
       * #445 — Shell is canonical: AppTopNav (layout.tsx) now includes Trades
       * and highlights the active route, so this page no longer renders a
       * duplicate "Trades" heading. The Create Trade action and filter tabs
       * remain as page-specific controls within the single shell.
       */}
      <div className="flex items-center justify-end mb-6">
        <Link href="/trades/create">
          <Button variant="primary">Create Trade</Button>
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="mb-6" role="tablist" aria-label="Trade filters">
        <div className="flex items-center gap-2">
          {FILTERS.map((filter) => {
            const isActive = activeFilter === filter.value;

            return (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleFilter(filter.value)}
                className={`${NAV_ITEM_BASE} ${isActive ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE}`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading state */}
      {loading && <TradesTableSkeleton />}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-status-danger/40 bg-status-danger/15 px-4 py-3 text-center">
          <p className="text-status-danger text-sm">{error}</p>
        </div>
      )}

      {/* Trade list */}
      {!loading && !error && (
        <>
          {trades.length === 0 ? (
            <div className="rounded-lg border border-border-default bg-surface-1 py-20 px-6 text-center shadow-elev-1">
              {/* Icon */}
              <div className="flex justify-center mb-6">
                <div className="w-16 h-16 rounded-lg bg-surface-2 border border-border-default flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>

              {/* Heading */}
              <h3 className="text-xl font-semibold text-text-primary mb-3">
                No trades yet
              </h3>

              {/* Description */}
              <p className="text-text-secondary text-sm mb-8 max-w-sm mx-auto leading-relaxed">
                Get started by creating your first trade to begin settling
                agricultural transactions securely on the blockchain.
              </p>

              {/* CTA Button */}
              <Link href="/trades/create">
                <Button variant="primary" size="lg">Create Your First Trade</Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
              <table className="w-full text-sm">
                <thead>
                  {/* Header: surface-1 (card level), subtle bottom border */}
                  <tr className="border-b border-border-default bg-surface-1">
                    <th className="text-left px-4 py-3 text-text-muted font-medium">
                      ID
                    </th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">
                      Counterparty
                    </th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">
                      Amount
                    </th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => (
                    <tr
                      key={trade.tradeId}
                      // Even rows: surface-0 (canvas), odd rows: surface-1 (card).
                      // Hover lifts to surface-2 + elev-2 shadow for clear depth feedback.
                      className={`border-b border-border-default last:border-0 hover:bg-surface-2 hover:shadow-elev-2 transition-colors ${
                        i % 2 === 0 ? "bg-surface-0" : "bg-surface-1"
                      }`}
                    >
                      <td className="px-4 py-3 text-gold font-mono">
                        <Link
                          href={`/trades/${trade.tradeId}`}
                          className="hover:underline underline-offset-4"
                        >
                          {trade.tradeId.slice(0, 8)}...
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-secondary font-mono">
                        {formatAddress(trade.sellerAddress)}
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        {trade.amountCngn} cNGN
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            STATUS_STYLES[trade.status] ?? "text-text-muted"
                          }`}
                        >
                          {trade.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDate(trade.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 text-sm text-text-secondary">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-md border border-border-default hover:border-border-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-md border border-border-default hover:border-border-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
