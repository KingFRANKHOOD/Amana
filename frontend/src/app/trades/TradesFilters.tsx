"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics } from "@/components/AnalyticsProvider";
import { useToast } from "@/hooks/useToast";
import { api, ApiError, type TradeResponse } from "@/lib/api";
import { useTradeStream } from "@/hooks/useTradeStream";
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

function toExportStatus(status: TradeStatus): string | undefined {
  const statusMap: Partial<Record<TradeStatus, string>> = {
    active: "FUNDED",
    pending: "PENDING_SIGNATURE",
    completed: "COMPLETED",
    disputed: "DISPUTED",
  };

  return statusMap[status];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

  const fetchTrades = useCallback(async () => {
    trackFunnelStep("trade_page_view", { filter: currentStatus, page: currentPage });

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
  }, [token, isAuthenticated, currentStatus, currentPage, trackApiFailure, trackFunnelStep]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchTrades();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchTrades]);

  // Live updates — refresh the list when a trade event arrives.
  useTradeStream({
    token,
    enabled: isAuthenticated && !!token,
    onEvent: () => {
      void fetchTrades();
    },
  });

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!token) return;

    setExporting(true);
    try {
      const blob = await api.trades.export(token, {
        status: toExportStatus(currentStatus),
      });
      downloadBlob(blob, `trades-${Date.now()}.csv`);
      addToast({ type: "success", message: "Trades exported" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      addToast({ type: "error", message });
    } finally {
      setExporting(false);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={currentStatus === f.value ? "primary" : "secondary"}
              size="sm"
              onClick={() => handleFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleExport}
          disabled={exporting || trades.length === 0}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <TradesTableSkeleton />
      ) : trades.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-surface-0 px-6 py-12 text-center">
          <p className="text-sm text-text-secondary">No trades found.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
          <div className="border-b border-border-default bg-surface-1 px-4 py-3">
            <div className="grid grid-cols-5 gap-4 text-xs font-medium uppercase tracking-wide text-text-tertiary">
              <span>Trade</span>
              <span>Counterparty</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Date</span>
            </div>
          </div>
          <div className="divide-y divide-border-default bg-surface-0">
            {trades.map((trade) => (
              <Link
                key={trade.id}
                href={`/trades/${trade.id}`}
                className="grid grid-cols-5 gap-4 px-4 py-4 text-sm transition-colors hover:bg-surface-1"
              >
                <span className="font-mono text-text-primary">
                  {formatAddress(trade.id)}
                </span>
                <span className="font-mono text-text-secondary">
                  {formatAddress(trade.counterparty ?? "—")}
                </span>
                <span className="text-text-primary">
                  {trade.amountUsdc} USDC
                </span>
                <span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[trade.status?.toLowerCase()] ?? STATUS_STYLES.draft
                    }`}
                  >
                    {trade.status}
                  </span>
                </span>
                <span className="text-text-secondary">
                  {formatDate(trade.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <NavButton
            direction="prev"
            disabled={currentPage <= 1}
            onClick={() => handlePage(currentPage - 1)}
          />
          <span className="text-sm text-text-secondary">
            Page {currentPage} of {totalPages}
          </span>
          <NavButton
            direction="next"
            disabled={currentPage >= totalPages}
            onClick={() => handlePage(currentPage + 1)}
          />
        </div>
      )}
    </div>
  );
}
