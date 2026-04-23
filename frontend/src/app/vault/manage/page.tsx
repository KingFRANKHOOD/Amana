"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import {
  api,
  type TradeResponse,
  type TradeStatsResponse,
  ApiError,
} from "@/lib/api";
import {
  PaymentOverviewCard,
  AuditLogCard,
  NetworkBackboneCard,
  VaultFooter,
} from "@/components/vault";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionModal =
  | { type: "deposit"; trade: TradeResponse }
  | { type: "release"; trade: TradeResponse }
  | { type: "dispute"; trade: TradeResponse }
  | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { pill: string; dot: string }> = {
  active: {
    pill: "text-status-success bg-emerald-muted",
    dot: "bg-status-success",
  },
  pending: {
    pill: "text-status-warning bg-status-warning/15",
    dot: "bg-status-warning",
  },
  completed: {
    pill: "text-text-secondary bg-bg-elevated",
    dot: "bg-text-muted",
  },
  disputed: {
    pill: "text-status-danger bg-status-danger/15",
    dot: "bg-status-danger",
  },
  locked: { pill: "text-status-locked bg-gold-muted", dot: "bg-gold" },
};

function statusStyle(status: string) {
  return (
    STATUS_STYLES[status.toLowerCase()] ?? {
      pill: "text-text-muted bg-bg-elevated",
      dot: "bg-text-muted",
    }
  );
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function shortAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-card p-5 flex flex-col gap-1">
      <p className="text-xs uppercase tracking-widest text-text-muted">
        {label}
      </p>
      <p
        className={`text-2xl font-bold ${accent ? "text-gold" : "text-text-primary"}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-text-secondary">{sub}</p>}
    </div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  label,
  variant = "ghost",
  onClick,
  disabled,
}: {
  label: string;
  variant?: "gold" | "danger" | "ghost";
  onClick: () => void;
  disabled?: boolean;
}) {
  const base =
    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    gold: "bg-gold text-text-inverse hover:bg-gold-hover",
    danger:
      "border border-status-danger/40 text-status-danger hover:bg-status-danger/10",
    ghost:
      "border border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles[variant]}`}
    >
      {label}
    </button>
  );
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  modal,
  onClose,
  onConfirm,
  busy,
  disputeReason,
  setDisputeReason,
  disputeCategory,
  setDisputeCategory,
}: {
  modal: ActionModal;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  disputeReason: string;
  setDisputeReason: (v: string) => void;
  disputeCategory: string;
  setDisputeCategory: (v: string) => void;
}) {
  if (!modal) return null;

  const titles: Record<NonNullable<ActionModal>["type"], string> = {
    deposit: "Confirm Deposit",
    release: "Release Funds",
    dispute: "Initiate Dispute",
  };

  const descriptions: Record<NonNullable<ActionModal>["type"], string> = {
    deposit: `Deposit ${modal.trade.amountUsdc} USDC into escrow for trade ${modal.trade.tradeId.slice(0, 8)}…`,
    release: `Release ${modal.trade.amountUsdc} USDC to the seller for trade ${modal.trade.tradeId.slice(0, 8)}…`,
    dispute: `Open a dispute for trade ${modal.trade.tradeId.slice(0, 8)}…`,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-card p-6 shadow-card mx-4">
        <h2
          id="modal-title"
          className="text-lg font-semibold text-text-primary mb-2"
        >
          {titles[modal.type]}
        </h2>
        <p className="text-sm text-text-secondary mb-5">
          {descriptions[modal.type]}
        </p>

        {modal.type === "dispute" && (
          <div className="space-y-3 mb-5">
            <div>
              <label
                className="block text-xs text-text-secondary mb-1"
                htmlFor="dispute-category"
              >
                Category
              </label>
              <select
                id="dispute-category"
                value={disputeCategory}
                onChange={(e) => setDisputeCategory(e.target.value)}
                className="w-full rounded-lg border border-border-default bg-bg-input text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-border-focus"
              >
                <option value="non_delivery">Non-delivery</option>
                <option value="quality_issue">Quality issue</option>
                <option value="payment_dispute">Payment dispute</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label
                className="block text-xs text-text-secondary mb-1"
                htmlFor="dispute-reason"
              >
                Reason
              </label>
              <textarea
                id="dispute-reason"
                rows={3}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Describe the issue…"
                className="w-full rounded-lg border border-border-default bg-bg-input text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-border-focus resize-none"
              />
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-border-default text-text-secondary text-sm hover:border-border-hover transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={
              busy || (modal.type === "dispute" && !disputeReason.trim())
            }
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              modal.type === "dispute"
                ? "bg-status-danger text-white hover:bg-status-danger/80"
                : "bg-gold text-text-inverse hover:bg-gold-hover"
            }`}
          >
            {busy ? "Processing…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

function AuthGate({
  isWalletConnected,
  isLoading,
  connectWallet,
  authenticate,
}: {
  isWalletConnected: boolean;
  isLoading: boolean;
  connectWallet: () => void;
  authenticate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-5">
      <div className="w-16 h-16 rounded-2xl bg-gold-muted border border-gold/30 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-gold"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-text-primary">
          Authentication required
        </p>
        <p className="text-sm text-text-secondary mt-1">
          Connect and sign in with Freighter to manage your vaults.
        </p>
      </div>
      <button
        type="button"
        onClick={isWalletConnected ? authenticate : connectWallet}
        disabled={isLoading}
        className="rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-text-inverse hover:bg-gold-hover transition-colors disabled:opacity-60"
      >
        {isLoading
          ? "Loading…"
          : isWalletConnected
            ? "Sign In"
            : "Connect Freighter"}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const FOOTER = {
  version: "V4.8.2",
  links: [
    { label: "Privacy Protocol", href: "#" },
    { label: "Compliance", href: "#" },
    { label: "Audit Report", href: "#" },
  ],
  socialLinks: [
    { platform: "x" as const, href: "#" },
    { platform: "instagram" as const, href: "#" },
    { platform: "tiktok" as const, href: "#" },
    { platform: "discord" as const, href: "#" },
  ],
};

const DISPUTE_CATEGORIES = [
  "non_delivery",
  "quality_issue",
  "payment_dispute",
  "other",
];

export default function VaultManagePage() {
  const {
    token,
    isAuthenticated,
    isWalletConnected,
    isLoading: authLoading,
    connectWallet,
    authenticate,
  } = useAuth();

  // Data
  const [stats, setStats] = useState<TradeStatsResponse | null>(null);
  const [trades, setTrades] = useState<TradeResponse[]>([]);
  const [walletBalance, setWalletBalance] = useState<{
    balance: string;
    asset: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<"active" | "all">("active");
  const [modal, setModal] = useState<ActionModal>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeCategory, setDisputeCategory] = useState(DISPUTE_CATEGORIES[0]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [statsData, tradesData, balanceData] = await Promise.all([
        api.trades.getStats(token),
        api.trades.list(token, { limit: 50 }),
        api.wallet.getBalance(token),
      ]);
      setStats(statsData);
      setTrades(tradesData.items);
      setWalletBalance(balanceData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load vault data",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isAuthenticated && token) void fetchData();
  }, [isAuthenticated, token, fetchData]);

  // Derived
  const displayedTrades =
    activeTab === "active"
      ? trades.filter((t) =>
          ["active", "pending", "locked"].includes(t.status.toLowerCase()),
        )
      : trades;

  const totalLocked = trades
    .filter((t) => ["active", "locked"].includes(t.status.toLowerCase()))
    .reduce((sum, t) => sum + parseFloat(t.amountUsdc), 0);

  const auditEntries = trades.slice(0, 3).map((trade, i) => ({
    type: (["biometric", "multi-sig", "ledger"] as const)[i % 3],
    title: `Trade ${trade.status.toLowerCase().replace(/_/g, " ")}`,
    metadata: `${fmt(trade.updatedAt)} · ${trade.tradeId.slice(0, 8)}`,
  }));

  // Actions
  async function handleConfirm() {
    if (!modal || !token) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (modal.type === "deposit") {
        await api.trades.deposit(token, modal.trade.tradeId);
        setActionSuccess("Deposit transaction prepared — sign in Freighter.");
      } else if (modal.type === "release") {
        await api.trades.releaseFunds(token, modal.trade.tradeId);
        setActionSuccess("Release transaction prepared — sign in Freighter.");
      } else if (modal.type === "dispute") {
        await api.trades.initiateDispute(
          token,
          modal.trade.tradeId,
          disputeReason,
          disputeCategory,
        );
        setActionSuccess("Dispute initiated successfully.");
      }
      setModal(null);
      setDisputeReason("");
      void fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Action failed";
      setActionError(msg);
    } finally {
      setActionBusy(false);
    }
  }

  function openModal(
    type: NonNullable<ActionModal>["type"],
    trade: TradeResponse,
  ) {
    setActionError(null);
    setDisputeReason("");
    setDisputeCategory(DISPUTE_CATEGORIES[0]);
    setModal({ type, trade } as ActionModal);
  }

  return (
    <section className="min-h-full bg-bg-primary px-6 py-8 lg:px-10">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
              <Link
                href="/vault"
                className="hover:text-text-secondary transition-colors"
              >
                Vault
              </Link>
              <span>/</span>
              <span className="text-text-secondary">Manage</span>
            </div>
            <h1 className="text-2xl font-bold text-text-primary">
              Vault Management
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Deposit, release, and manage your active escrow positions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchData()}
            disabled={loading || !isAuthenticated}
            className="self-start sm:self-auto flex items-center gap-2 rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors disabled:opacity-40"
          >
            <svg
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M14 8A6 6 0 112 8" />
              <path d="M14 8l-2-2M14 8l2-2" />
            </svg>
            Refresh
          </button>
        </div>

        {/* ── Auth gate ── */}
        {!isAuthenticated && (
          <AuthGate
            isWalletConnected={isWalletConnected}
            isLoading={authLoading}
            connectWallet={connectWallet}
            authenticate={authenticate}
          />
        )}

        {isAuthenticated && (
          <>
            {/* ── Global error / success banners ── */}
            {error && (
              <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-4 py-3 text-sm text-status-danger flex items-center justify-between">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-4 text-status-danger/60 hover:text-status-danger"
                >
                  ✕
                </button>
              </div>
            )}
            {actionError && (
              <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-4 py-3 text-sm text-status-danger flex items-center justify-between">
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="ml-4 text-status-danger/60 hover:text-status-danger"
                >
                  ✕
                </button>
              </div>
            )}
            {actionSuccess && (
              <div className="rounded-lg border border-status-success/20 bg-status-success/10 px-4 py-3 text-sm text-status-success flex items-center gap-2">
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M2 8l4 4 8-8" />
                </svg>
                {actionSuccess}
              </div>
            )}

            {/* ── Stats row ── */}
            {loading && !stats ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-border-default bg-card p-5 h-24 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Total Trades"
                  value={stats?.totalTrades ?? 0}
                  sub="All time"
                />
                <StatCard
                  label="Open Trades"
                  value={stats?.openTrades ?? 0}
                  sub="Awaiting action"
                  accent
                />
                <StatCard
                  label="Locked in Escrow"
                  value={`$${totalLocked.toLocaleString()}`}
                  sub="USDC"
                  accent
                />
                <StatCard
                  label="Wallet Balance"
                  value={
                    walletBalance
                      ? `${parseFloat(walletBalance.balance).toLocaleString()} ${walletBalance.asset}`
                      : "—"
                  }
                  sub="Available"
                />
              </div>
            )}

            {/* ── Main grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* ── Escrow positions table (2/3 width) ── */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-text-primary">
                    Escrow Positions
                  </h2>
                  <div className="flex gap-1 rounded-lg border border-border-default p-1 bg-bg-elevated">
                    {(["active", "all"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                          activeTab === tab
                            ? "bg-gold text-text-inverse"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>

                {loading && trades.length === 0 ? (
                  <div className="rounded-2xl border border-border-default bg-card overflow-hidden">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="px-4 py-4 border-b border-border-default last:border-0 animate-pulse"
                      >
                        <div className="h-4 bg-bg-elevated rounded w-3/4" />
                      </div>
                    ))}
                  </div>
                ) : displayedTrades.length === 0 ? (
                  <div className="rounded-2xl border border-border-default bg-card px-6 py-16 text-center">
                    <div className="w-12 h-12 rounded-xl bg-bg-elevated border border-border-default flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="w-6 h-6 text-text-muted"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                        <circle cx="12" cy="12" r="2" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-text-primary">
                      No {activeTab === "active" ? "active " : ""}escrow
                      positions
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      {activeTab === "active"
                        ? "Switch to 'All' to see completed trades."
                        : "Create a trade to get started."}
                    </p>
                    <Link
                      href="/trades/create"
                      className="inline-block mt-4 px-4 py-2 rounded-lg bg-gold text-text-inverse text-sm font-semibold hover:bg-gold-hover transition-colors"
                    >
                      Create Trade
                    </Link>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border-default bg-card overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-4 py-3 border-b border-border-default bg-bg-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                      <span>Trade</span>
                      <span>Amount</span>
                      <span>Status</span>
                      <span>Actions</span>
                    </div>

                    {/* Rows */}
                    {displayedTrades.map((trade) => {
                      const s = statusStyle(trade.status);
                      const isPending =
                        trade.status.toLowerCase() === "pending";
                      const isActive = trade.status.toLowerCase() === "active";
                      const isLocked = trade.status.toLowerCase() === "locked";
                      const canDeposit = isPending;
                      const canRelease = isActive || isLocked;
                      const canDispute = isActive || isLocked || isPending;

                      return (
                        <div
                          key={trade.tradeId}
                          className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 items-center px-4 py-4 border-b border-border-default last:border-0 hover:bg-bg-elevated/50 transition-colors"
                        >
                          {/* Trade info */}
                          <div className="min-w-0">
                            <Link
                              href={`/trades/${trade.tradeId}`}
                              className="text-sm font-mono text-gold hover:underline underline-offset-4 truncate block"
                            >
                              {trade.tradeId.slice(0, 10)}…
                            </Link>
                            <p className="text-xs text-text-muted mt-0.5">
                              {fmt(trade.createdAt)}
                            </p>
                          </div>

                          {/* Amount */}
                          <div>
                            <p className="text-sm font-semibold text-text-primary">
                              {parseFloat(trade.amountUsdc).toLocaleString()}{" "}
                              USDC
                            </p>
                            <p className="text-xs text-text-muted mt-0.5">
                              Seller: {shortAddr(trade.sellerAddress)}
                            </p>
                          </div>

                          {/* Status badge */}
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize ${s.pill}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${s.dot}`}
                            />
                            {trade.status.toLowerCase().replace(/_/g, " ")}
                          </span>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2">
                            {canDeposit && (
                              <ActionBtn
                                label="Deposit"
                                variant="gold"
                                onClick={() => openModal("deposit", trade)}
                              />
                            )}
                            {canRelease && (
                              <ActionBtn
                                label="Release"
                                variant="gold"
                                onClick={() => openModal("release", trade)}
                              />
                            )}
                            {canDispute && (
                              <ActionBtn
                                label="Dispute"
                                variant="danger"
                                onClick={() => openModal("dispute", trade)}
                              />
                            )}
                            {!canDeposit && !canRelease && !canDispute && (
                              <span className="text-xs text-text-muted italic">
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick-link to full trades list */}
                <div className="flex justify-end">
                  <Link
                    href="/trades"
                    className="text-xs text-text-secondary hover:text-gold transition-colors flex items-center gap-1"
                  >
                    View all trades
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M2 6h8M7 3l3 3-3 3" />
                    </svg>
                  </Link>
                </div>
              </div>

              {/* ── Right column (1/3 width) ── */}
              <div className="space-y-6">
                {/* Payment overview */}
                <PaymentOverviewCard totalUsdc={totalLocked} ngnRate={1580} />

                {/* Audit log */}
                <AuditLogCard
                  entries={
                    auditEntries.length > 0
                      ? auditEntries
                      : [
                          {
                            type: "ledger",
                            title: "No recent activity",
                            metadata: "Connect wallet to view",
                          },
                        ]
                  }
                  isLiveSync={isAuthenticated}
                />
              </div>
            </div>

            {/* ── Network backbone ── */}
            <NetworkBackboneCard description="Secured and powered by the Stellar network for instantaneous cross-border settlement and verifiable transparency." />

            {/* ── Footer ── */}
            <VaultFooter
              version={FOOTER.version}
              links={FOOTER.links}
              socialLinks={FOOTER.socialLinks}
            />
          </>
        )}
      </div>

      {/* ── Action modal ── */}
      <ConfirmModal
        modal={modal}
        onClose={() => setModal(null)}
        onConfirm={handleConfirm}
        busy={actionBusy}
        disputeReason={disputeReason}
        setDisputeReason={setDisputeReason}
        disputeCategory={disputeCategory}
        setDisputeCategory={setDisputeCategory}
      />
    </section>
  );
}
