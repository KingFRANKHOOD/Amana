"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, TradeResponse } from "@/lib/api";

type TradeStatus = "all" | "active" | "pending" | "completed" | "disputed";

const FILTERS: { label: string; value: TradeStatus }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Completed", value: "completed" },
  { label: "Disputed", value: "disputed" },
];

const STATUS_STYLES: Record<string, string> = {
  active: "text-status-success bg-emerald-muted",
  pending: "text-status-warning bg-status-warning/15",
  completed: "text-text-secondary bg-bg-elevated",
  disputed: "text-status-danger bg-status-danger/15",
  locked: "text-status-locked bg-gold-muted",
};

const PAGE_SIZE = 10;

export default function TradesPage() {
  const { token, isAuthenticated } = useAuth();
  const [activeFilter, setActiveFilter] = useState<TradeStatus>("all");
  const [page, setPage] = useState(1);
  const [trades, setTrades] = useState<TradeResponse[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        if (err instanceof ApiError) {
          errorMessage = err.message;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
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
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Trades</h1>
        <Link
          href="/trades/create"
          className="px-4 py-2 rounded-md bg-gold text-text-inverse text-sm font-medium hover:bg-gold-hover transition-colors"
        >
          Create Trade
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-border-default pb-[1px] mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilter(f.value)}
            className={`pb-3 px-1 text-sm transition-colors ${
              activeFilter === f.value
                ? "text-gold underline underline-offset-8 decoration-gold decoration-2"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <svg
            className="animate-spin w-8 h-8 text-gold"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        </div>
      )}

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
            <div className="rounded-lg border border-border-default bg-bg-card py-20 px-6 text-center">
              {/* Icon */}
              <div className="flex justify-center mb-6">
                <div className="w-16 h-16 rounded-lg bg-bg-elevated border border-border-default flex items-center justify-center">
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
              <Link
                href="/trades/create"
                className="inline-block px-6 py-3 rounded-lg bg-gold text-text-inverse text-sm font-semibold hover:bg-gold-hover transition-colors"
              >
                Create Your First Trade
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-border-default overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-bg-card">
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
                      className={`border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors ${
                        i % 2 === 0 ? "bg-bg-primary" : "bg-bg-card"
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
                        {trade.amountUsdc} USDC
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
