"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { api, type TradeStatsResponse, type TradeResponse } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  TrendingUp,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

type StatusFilter = "all" | "active" | "pending" | "completed" | "disputed";

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Completed", value: "completed" },
  { label: "Disputed", value: "disputed" },
];

const STATUS_STYLES: Record<string, string> = {
  active:    "text-status-success bg-status-success/10 border border-status-success/20",
  funded:    "text-status-success bg-status-success/10 border border-status-success/20",
  pending:   "text-status-warning bg-status-warning/10 border border-status-warning/20",
  created:   "text-status-warning bg-status-warning/10 border border-status-warning/20",
  completed: "text-text-secondary bg-surface-2 border border-border-default",
  settled:   "text-text-secondary bg-surface-2 border border-border-default",
  disputed:  "text-status-danger bg-status-danger/10 border border-status-danger/20",
  cancelled: "text-text-muted bg-surface-1 border border-border-default",
  delivered: "text-status-info bg-status-info/10 border border-status-info/20",
};

const ASSET_NAV = [
  {
    href: "/vault",
    label: "Vaults",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="1" y="3" width="14" height="11" rx="1.5" />
        <circle cx="8" cy="8.5" r="2" />
        <path d="M8 3V1" />
      </svg>
    ),
  },
  {
    href: "/assets",
    label: "Assets",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
      </svg>
    ),
  },
  {
    href: "/trades",
    label: "History",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4v4l3 2" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Security",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 1l5 2.2V7c0 3.3-2.3 5.8-5 6.8C3.3 12.8 1 10.3 1 7V3.2L8 1z" />
      </svg>
    ),
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function AssetsSidebar({
  shortAddress,
  isAuthenticated,
}: {
  shortAddress: string | null;
  isAuthenticated: boolean;
}) {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 bg-surface-1 border-r border-border-default flex flex-col min-h-full">
      <div className="px-4 py-5 border-b border-border-default">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold/30 flex items-center justify-center text-gold shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-primary truncate">Asset Manager</p>
            <p className="text-[10px] uppercase tracking-widest text-gold truncate">Portfolio View</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3" aria-label="Asset navigation">
        <ul className="space-y-0.5">
          {ASSET_NAV.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-all border-l-2 ${
                    isActive
                      ? "border-l-gold bg-surface-2 text-gold font-medium"
                      : "border-transparent text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="uppercase tracking-wider text-xs font-semibold">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-4 pb-4">
        <Link href="/trades/create" className="block">
          <Button variant="primary" className="w-full">+ New Asset</Button>
        </Link>
      </div>

      <div className="px-4 py-4 border-t border-border-default">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-surface-2 border border-border-default flex items-center justify-center text-text-secondary shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="8" cy="5" r="3" />
              <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-primary truncate">
              {shortAddress ?? "Not connected"}
            </p>
            <p className="text-[10px] text-text-muted truncate">
              {isAuthenticated ? "Pro Member" : "Guest"}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "gold" | "emerald" | "danger" | "warning";
  loading?: boolean;
}

function SummaryCard({ label, value, sub, icon, accent = "gold", loading }: SummaryCardProps) {
  const accentMap = {
    gold:    "text-gold bg-gold-muted border-gold/20",
    emerald: "text-emerald bg-emerald-muted border-emerald/20",
    danger:  "text-status-danger bg-status-danger/10 border-status-danger/20",
    warning: "text-status-warning bg-status-warning/10 border-status-warning/20",
  };
  const iconClass = accentMap[accent];

  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${iconClass}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-muted uppercase tracking-wider mb-1">{label}</p>
        {loading ? (
          <Skeleton className="h-6 w-24 mb-1" />
        ) : (
          <p className="text-xl font-bold text-text-primary truncate">{value}</p>
        )}
        {sub && !loading && (
          <p className="text-xs text-text-secondary mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ─── Allocation Bar ───────────────────────────────────────────────────────────

interface AllocationBarProps {
  trades: TradeResponse[];
  loading: boolean;
}

function AllocationBar({ trades, loading }: AllocationBarProps) {
  const counts = useMemo(() => {
    const map: Record<string, number> = { active: 0, pending: 0, completed: 0, disputed: 0, other: 0 };
    for (const t of trades) {
      const s = t.status.toLowerCase();
      if (s === "funded" || s === "active" || s === "delivered") map.active++;
      else if (s === "created" || s === "pending") map.pending++;
      else if (s === "completed" || s === "settled") map.completed++;
      else if (s === "disputed") map.disputed++;
      else map.other++;
    }
    return map;
  }, [trades]);

  const total = trades.length || 1;
  const segments = [
    { key: "active",    label: "Active",    color: "bg-status-success", pct: (counts.active / total) * 100 },
    { key: "pending",   label: "Pending",   color: "bg-status-warning", pct: (counts.pending / total) * 100 },
    { key: "completed", label: "Completed", color: "bg-text-secondary", pct: (counts.completed / total) * 100 },
    { key: "disputed",  label: "Disputed",  color: "bg-status-danger",  pct: (counts.disputed / total) * 100 },
    { key: "other",     label: "Other",     color: "bg-surface-2",      pct: (counts.other / total) * 100 },
  ].filter((s) => s.pct > 0);

  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Asset Allocation</h3>
      {loading ? (
        <Skeleton className="h-3 w-full rounded-full" />
      ) : trades.length === 0 ? (
        <p className="text-xs text-text-muted">No assets to display.</p>
      ) : (
        <>
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-4" role="img" aria-label="Asset allocation breakdown">
            {segments.map((s) => (
              <div
                key={s.key}
                className={`${s.color} transition-all`}
                style={{ width: `${s.pct}%` }}
                title={`${s.label}: ${Math.round(s.pct)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-xs text-text-secondary">{s.label}</span>
                <span className="text-xs font-semibold text-text-primary">{Math.round(s.pct)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Asset Table ──────────────────────────────────────────────────────────────

interface AssetTableProps {
  trades: TradeResponse[];
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  search: string;
  onSearchChange: (s: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (s: StatusFilter) => void;
  onRefresh: () => void;
}

function AssetTableSkeleton() {
  return (
    <div className="divide-y divide-border-default">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 items-center px-6 py-4">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ))}
    </div>
  );
}

function AssetTable({
  trades, loading, page, totalPages,
  onPageChange, search, onSearchChange,
  statusFilter, onStatusFilterChange, onRefresh,
}: AssetTableProps) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 overflow-hidden">
      {/* Table toolbar */}
      <div className="px-6 py-4 border-b border-border-default flex flex-col sm:flex-row sm:items-center gap-3">
        <h2 className="text-sm font-semibold text-text-primary shrink-0">Asset Positions</h2>

        <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:items-center">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input
              type="search"
              placeholder="Search by ID or address…"
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-2 border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold/50 transition-colors"
              aria-label="Search assets"
            />
          </div>

          {/* Status filters */}
          <div className="flex gap-1 flex-wrap" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onStatusFilterChange(f.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === f.value
                    ? "bg-gold text-text-inverse"
                    : "bg-surface-2 text-text-secondary hover:text-text-primary"
                }`}
                aria-pressed={statusFilter === f.value}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-40"
          aria-label="Refresh assets"
        >
              <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>

        <Link
          href="/trades/create"
          className="shrink-0 text-xs font-semibold text-gold hover:text-gold-hover transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
          New Asset
        </Link>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-surface-2 text-xs font-medium text-text-muted uppercase tracking-wider border-b border-border-default">
        <span>Asset / Trade ID</span>
        <span>Amount (cNGN)</span>
        <span>Counterparty</span>
        <span>Status</span>
        <span>Action</span>
      </div>

      {/* Rows */}
      {loading ? (
        <AssetTableSkeleton />
      ) : trades.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-2 border border-border-default flex items-center justify-center mx-auto mb-4">
            <Activity className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-sm font-medium text-text-primary">No assets found</p>
          <p className="text-xs text-text-secondary mt-1">
            {search || statusFilter !== "all"
              ? "Try adjusting your search or filter."
              : "Create your first trade to register an asset."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-default">
          {trades.map((trade) => {
            const statusKey = trade.status.toLowerCase().replace(/_/g, "");
            const pill = STATUS_STYLES[statusKey] ?? "text-text-muted bg-surface-2 border border-border-default";
            const displayStatus = trade.status.toLowerCase().replace(/_/g, " ");

            return (
              <div
                key={trade.tradeId}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 items-center px-6 py-4 transition-colors hover:bg-surface-2/40"
              >
                <div className="min-w-0">
                  <Link
                    href={`/assets/${trade.tradeId}`}
                    className="text-sm font-mono text-gold hover:underline underline-offset-4 truncate block"
                  >
                    {trade.tradeId.slice(0, 14)}…
                  </Link>
                  <p className="text-xs text-text-muted mt-0.5">
                    {new Date(trade.createdAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </p>
                </div>

                <p className="text-sm font-semibold text-text-primary tabular-nums">
                  {parseFloat(trade.amountCngn).toLocaleString()}
                </p>

                <p className="text-sm text-text-secondary font-mono truncate">
                  {trade.sellerAddress.slice(0, 6)}…{trade.sellerAddress.slice(-4)}
                </p>

                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize w-fit ${pill}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
                  {displayStatus}
                </span>

                <Link
                  href={`/assets/${trade.tradeId}`}
                  className="text-xs font-semibold text-text-secondary hover:text-gold transition-colors whitespace-nowrap"
                  aria-label={`View asset ${trade.tradeId}`}
                >
                  View →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-border-default flex items-center justify-between">
          <p className="text-xs text-text-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors"
              aria-label="Previous page"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors"
              aria-label="Next page"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const {
    shortAddress,
    token,
    isAuthenticated,
    isWalletConnected,
    isLoading: authLoading,
    connectWallet,
    authenticate,
  } = useAuth();

  const [stats, setStats] = useState<TradeStatsResponse | null>(null);
  const [allTrades, setAllTrades] = useState<TradeResponse[]>([]);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [statsData, tradesData, balanceData] = await Promise.allSettled([
        api.trades.getStats(token),
        api.trades.list(token, { limit: 100 }),
        api.wallet.getBalance(token),
      ]);

      if (statsData.status === "fulfilled") setStats(statsData.value);
      if (tradesData.status === "fulfilled") setAllTrades(tradesData.value.items);
      if (balanceData.status === "fulfilled") setBalance(balanceData.value.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load asset data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAuthenticated && token) void fetchData();
  }, [isAuthenticated, token, fetchData]);

  // Filter trades client-side
  const filteredTrades = useMemo(() => {
    let result = allTrades;

    if (statusFilter !== "all") {
      result = result.filter((t: TradeResponse) => {
        const s = t.status.toLowerCase();
        if (statusFilter === "active")    return s === "funded" || s === "active" || s === "delivered";
        if (statusFilter === "pending")   return s === "created" || s === "pending";
        if (statusFilter === "completed") return s === "completed" || s === "settled";
        if (statusFilter === "disputed")  return s === "disputed";
        return true;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t: TradeResponse) =>
          t.tradeId.toLowerCase().includes(q) ||
          t.sellerAddress.toLowerCase().includes(q) ||
          t.buyerAddress.toLowerCase().includes(q),
      );
    }

    return result;
  }, [allTrades, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  const pagedTrades = filteredTrades.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Derived summary values
  const totalVolume = stats?.totalVolume ?? 0;
  const openTrades  = stats?.openTrades  ?? 0;
  const totalTrades = stats?.totalTrades ?? 0;
  const completedTrades = totalTrades - openTrades;
  const disputedCount = allTrades.filter((t: TradeResponse) => t.status.toLowerCase() === "disputed").length;

  const formattedBalance = balance
    ? parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  return (
    <div className="flex h-full min-h-full">
      {/* Contextual sidebar */}
      <AssetsSidebar shortAddress={shortAddress} isAuthenticated={isAuthenticated} />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Page header */}
        <div className="px-8 h-14 border-b border-border-default bg-surface-1 shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-text-primary">Asset Management</h1>
            <p className="text-xs text-text-muted">Your cNGN-backed trade positions</p>
          </div>
          {isAuthenticated && (
            <Link href="/trades/create">
              <Button variant="primary" className="text-xs">+ New Asset</Button>
            </Link>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto bg-surface-0">
          <div className="max-w-6xl mx-auto px-6 py-8 lg:px-10 space-y-6">

            {/* Auth banner */}
            {!isAuthenticated && !authLoading && (
              <div className="rounded-2xl border border-gold/20 bg-gold-muted px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gold">Connect your wallet</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Link your Freighter wallet to view live asset positions and balances.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={isWalletConnected ? authenticate : connectWallet}
                  disabled={authLoading}
                  className="shrink-0"
                >
                  {authLoading ? "Loading…" : isWalletConnected ? "Sign In" : "Connect Freighter"}
                </Button>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-4 py-3 text-sm text-status-danger flex items-center justify-between">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                label="Total Volume"
                value={loading ? "—" : `${totalVolume.toLocaleString()} cNGN`}
                sub="All-time escrow value"
                icon={<TrendingUp className="w-5 h-5" />}
                accent="gold"
                loading={loading && !stats}
              />
              <SummaryCard
                label="Wallet Balance"
                value={loading ? "—" : formattedBalance ? `${formattedBalance} cNGN` : isAuthenticated ? "—" : "N/A"}
                sub="Available cNGN"
                icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H6a2 2 0 00-2 2v2"/><circle cx="17" cy="14" r="1.5" fill="currentColor"/></svg>}
                accent="emerald"
                loading={loading && !balance}
              />
              <SummaryCard
                label="Open Trades"
                value={loading ? "—" : String(openTrades)}
                sub="Funded or in transit"
                icon={<Clock className="w-5 h-5" />}
                accent="warning"
                loading={loading && !stats}
              />
              <SummaryCard
                label="Completed"
                value={loading ? "—" : String(completedTrades)}
                sub={disputedCount > 0 ? `${disputedCount} disputed` : "No disputes"}
                icon={disputedCount > 0 ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                accent={disputedCount > 0 ? "danger" : "emerald"}
                loading={loading && !stats}
              />
            </div>

            {/* Allocation bar */}
            <AllocationBar trades={allTrades} loading={loading && allTrades.length === 0} />

            {/* Asset table */}
            <AssetTable
              key={`${search}-${statusFilter}`}
              trades={pagedTrades}
              loading={loading && allTrades.length === 0}
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              search={search}
              onSearchChange={setSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onRefresh={fetchData}
            />

          </div>
        </div>
      </div>
    </div>
  );
}
