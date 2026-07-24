"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics } from "@/components/AnalyticsProvider";
import { useToast } from "@/hooks/useToast";
import { api, ApiError, type TradeResponse } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { NavButton } from "@/components/ui/Navigation";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type TradeStatus = "all" | "active" | "pending" | "completed" | "disputed";

const FILTERS: { label: string; value: TradeStatus }[] = [
  { label: "All",       value: "all"       },
  { label: "Active",    value: "active"    },
  { label: "Pending",   value: "pending"   },
  { label: "Completed", value: "completed" },
  { label: "Disputed",  value: "disputed"  },
];

const STATUS_STYLES: Record<string, string> = {
  active:    "text-status-success bg-status-success/10 border border-status-success/20",
  pending:   "text-status-warning bg-status-warning/10 border border-status-warning/20",
  completed: "text-text-secondary bg-surface-2 border border-border-default",
  disputed:  "text-status-danger  bg-status-danger/10  border border-status-danger/20",
  locked:    "text-status-locked  bg-status-locked/10  border border-status-locked/20",
  draft:     "text-status-draft   bg-surface-1         border border-border-default",
};

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStatus(raw: string | null): TradeStatus {
  const valid: TradeStatus[] = ["active", "pending", "completed", "disputed"];
  return valid.includes(raw as TradeStatus) ? (raw as TradeStatus) : "all";
}

function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
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

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TradesTableSkeleton() {
  return (
    <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
      <div className="border-b border-border-default bg-surface-1 px-4 py-3">
        <div className="grid grid-cols-5 gap-4">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="divide-y divide-border-default bg-surface-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-5 gap-4 px-4 py-4">
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TradesFiltersProps {
  /** Initial values parsed from server-side searchParams — keeps URL state
   *  consistent on first render without a client-side flash. */
  initialStatus: TradeStatus;
  initialPage: number;
}

export function TradesFilters({ initialStatus, initialPage }: TradesFiltersProps) {
  const router    = useRouter();
  const pathname  = usePathname();
  const params    = useSearchParams();

  // Derive current filter/page from URL — falls back to server-passed
  // initial values so the first render is already correct.
  const currentStatus = parseStatus(params.get("status")) ?? initialStatus;
  const currentPage   = parsePage(params.get("page"))     ?? initialPage;

  const { token, isAuthenticated } = useAuth();
  const { trackApiFailure, trackFunnelStep } = useAnalytics();
  const { addToast } = useToast();

  const [trades,     setTrades]     = useState<TradeResponse[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // ------------------------------------------------------------------
  // URL helpers — write filter/page back into the URL so the address bar
  // is always the single source of truth.
  // ------------------------------------------------------------------

  const pushParams = useCallback(
    (status: TradeStatus, page: number) => {
      const next = new URLSearchParams(params.toString());

      if (status === "all") {
        next.delete("status");
      } else {
        next.set("status", status);
      }

      if (page <= 1) {
        next.delete("page");
      } else {
        next.set("page", String(page));
      }

      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  function handleFilter(value: TradeStatus) {
    pushParams(value, 1); // reset to page 1 on filter change
  }

  function handlePage(next: number) {
    pushParams(currentStatus, next);
  }

  // ------------------------------------------------------------------
  // Data fetching — driven entirely by URL-derived status + page.
  // ------------------------------------------------------------------

  useEffect(() => {
    trackFunnelStep("trade_page_view", { filter: currentStatus, page: currentPage });

    async function fetchTrades() {
      if (!isAuthenticated || !token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await api.trades.list(token, {
          status: currentStatus === "all" ? undefined : currentStatus,
          page:   currentPage,
          limit:  PAGE_SIZE,
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

        trackApiFailure("/trades", status, { message: errorMessage, filter: currentStatus });
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    void fetchTrades();
  }, [token, isAuthenticated, currentStatus, currentPage, trackApiFailure, trackFunnelStep]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <>
      {/* Action bar */}
      <div className="flex items-center justify-end gap-2 mb-6">
        <div className="hidden md:flex items-center gap-2 mr-2 border-r border-border-default pr-4">
          <button
            type="button"
            onClick={() => addToast({ type: "success", title: "Success", message: "Trade completed successfully!" })}
            className="px-3 py-1.5 rounded-md bg-status-success/10 border border-status-success/30 text-status-success text-xs font-medium hover:bg-status-success/20 transition-colors"
          >
            Success
          </button>
          <button
            type="button"
            onClick={() => addToast({ type: "error", title: "Error", message: "Failed to complete trade." })}
            className="px-3 py-1.5 rounded-md bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs font-medium hover:bg-status-danger/20 transition-colors"
          >
            Error
          </button>
          <button
            type="button"
            onClick={() => addToast({ type: "warning", title: "Warning", message: "Trade is disputed." })}
            className="px-3 py-1.5 rounded-md bg-status-warning/10 border border-status-warning/30 text-status-warning text-xs font-medium hover:bg-status-warning/20 transition-colors"
          >
            Warning
          </button>
          <button
            type="button"
            onClick={() => addToast({ type: "info", title: "Info", message: "New message received." })}
            className="px-3 py-1.5 rounded-md bg-status-info/10 border border-status-info/30 text-status-info text-xs font-medium hover:bg-status-info/20 transition-colors"
          >
            Info
          </button>
        </div>
        <Link href="/trades/create">
          <Button variant="primary">Create Trade</Button>
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="mb-6" role="tablist" aria-label="Trade filters">
        <div className="flex items-center gap-2">
          {FILTERS.map((filter) => {
            const isActive = currentStatus === filter.value;
            return (
              <NavButton
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleFilter(filter.value)}
                isActive={isActive}
              >
                {filter.label}
              </NavButton>
            );
          })}
        </div>
      </div>

      {/* Loading */}
      {loading && <TradesTableSkeleton />}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-status-danger/40 bg-status-danger/15 px-4 py-3 text-center">
          <p className="text-status-danger text-sm">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && !error && (
        <>
          {trades.length === 0 ? (
            <div className="rounded-lg border border-border-default bg-surface-1 py-20 px-6 text-center shadow-elev-1">
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
              <h3 className="text-xl font-semibold text-text-primary mb-3">No trades yet</h3>
              <p className="text-text-secondary text-sm mb-8 max-w-sm mx-auto leading-relaxed">
                Get started by creating your first trade to begin settling
                agricultural transactions securely on the blockchain.
              </p>
              <Link href="/trades/create">
                <Button variant="primary" size="lg">Create Your First Trade</Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-1">
                    <th className="text-left px-4 py-3 text-text-muted font-medium">ID</th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">Counterparty</th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">Amount</th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-text-muted font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => (
                    <tr
                      key={trade.tradeId}
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
              <span>Page {currentPage} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-md border border-border-default hover:border-border-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => handlePage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-md border border-border-default hover:border-border-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
