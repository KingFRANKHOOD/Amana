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

// Keys mirror the backend Prisma TradeStatus enum (backend/prisma/schema.prisma)
// so real `trade.status` values resolve to their intended colors instead of
// falling through to the default. Keep in sync with the backend enum.
const STATUS_STYLES: Record<string, string> = {
  PENDING_SIGNATURE: "text-status-warning bg-status-warning/10 border border-status-warning/20",
  CREATED:           "text-status-warning bg-status-warning/10 border border-status-warning/20",
  FUNDED:            "text-status-success bg-status-success/10 border border-status-success/20",
  DELIVERED:         "text-status-success bg-status-success/10 border border-status-success/20",
  COMPLETED:         "text-text-secondary bg-surface-2 border border-border-default",
  DISPUTED:          "text-status-danger  bg-status-danger/10  border border-status-danger/20",
  CANCELLED:         "text-status-draft   bg-surface-1         border border-border-default",
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
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={currentStatus === filter.value ? "primary" : "ghost"}
            size="sm"
            onClick={() => handleFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <TradesTableSkeleton />
      ) : error ? (
        <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 p-4 text-sm text-status-danger">
          {error}
        </div>
      ) : trades.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-surface-0 p-8 text-center text-sm text-text-muted">
          No trades found.
        </div>
      ) : (
        <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
          <table className="w-full text-sm">
            <thead className="border-b border-border-default bg-surface-1 text-left text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Trade</th>
                <th className="px-4 py-3 font-medium">Counterparty</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default bg-surface-0">
              {trades.map((trade) => (
                <tr key={trade.id} className="hover:bg-surface-1">
                  <td className="px-4 py-4">
                    <Link
                      href={`/trades/${trade.id}`}
                      className="font-medium text-text-primary hover:text-brand-primary"
                    >
                      {trade.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-text-secondary">
                    {formatAddress(trade.counterparty ?? "—")}
                  </td>
                  <td className="px-4 py-4 text-text-secondary">
                    {trade.amount ?? "—"}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[trade.status] ?? "text-text-muted"
                      }`}
                    >
                      {trade.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-text-secondary">
                    {formatDate(trade.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <NavButton
            disabled={currentPage <= 1}
            onClick={() => handlePage(currentPage - 1)}
          >
            Previous
          </NavButton>
          <span className="text-sm text-text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <NavButton
            disabled={currentPage >= totalPages}
            onClick={() => handlePage(currentPage + 1)}
          >
            Next
          </NavButton>
        </div>
      )}
    </div>
  );
}
