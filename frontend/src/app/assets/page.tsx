"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  api,
  type TradeStatsResponse,
  type TradeListResponse,
} from "@/lib/api";
import {
  VaultHero,
  ReleaseSequenceCard,
  VaultValueCard,
  ContractManifestCard,
  AuditLogCard,
  NetworkBackboneCard,
  VaultFooter,
} from "@/components/vault";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonList } from "@/components/ui/SkeletonList";

// ─── Constants ────────────────────────────────────────────────────────────────

const FOOTER_CONTENT = {
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

// ─── Assets Sidebar ───────────────────────────────────────────────────────────

const ASSET_NAV = [
  {
    href: "/vault",
    label: "Vaults",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
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
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
      </svg>
    ),
  },
  {
    href: "/trades",
    label: "History",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4v4l3 2" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Security",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M8 1l5 2.2V7c0 3.3-2.3 5.8-5 6.8C3.3 12.8 1 10.3 1 7V3.2L8 1z" />
      </svg>
    ),
  },
];

function AssetsSidebar({
  shortAddress,
  isAuthenticated,
}: {
  shortAddress: string | null;
  isAuthenticated: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 bg-card border-r border-border-default flex flex-col min-h-full">
      {/* Master Vault badge */}
      <div className="px-4 py-5 border-b border-border-default">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold/30 flex items-center justify-center text-gold shrink-0">
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M8 1l5 2.2V7c0 3.3-2.3 5.8-5 6.8C3.3 12.8 1 10.3 1 7V3.2L8 1z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-primary truncate">
              Master Vault
            </p>
            <p className="text-[10px] uppercase tracking-widest text-gold truncate">
              Verified Sentinel
            </p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3" aria-label="Asset navigation">
        <ul className="space-y-0.5">
          {ASSET_NAV.map((item) => {
            const isActive =
              pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-all border-l-2 ${
                    isActive
                      ? "border-l-gold bg-elevated text-gold font-medium"
                      : "border-transparent text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="uppercase tracking-wider text-xs font-semibold">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* New Asset CTA */}
      <div className="px-4 pb-4">
        <Link
          href="/trades/create"
          className="block w-full rounded-lg bg-gold text-text-inverse text-sm font-semibold text-center py-2.5 hover:bg-gold-hover transition-colors"
        >
          + NEW ASSET
        </Link>
      </div>

      {/* User profile */}
      <div className="px-4 py-4 border-t border-border-default">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center text-text-secondary shrink-0">
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
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

// ─── Top sub-nav (Overview / Active Vault / History) ─────────────────────────

const SUB_NAV = [
  { label: "Overview", href: "/assets" },
  { label: "Active Vault", href: "/vault" },
  { label: "History", href: "/trades" },
];

function AssetsSubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-6 px-8 h-11 border-b border-border-default bg-card shrink-0"
      aria-label="Assets sub-navigation"
    >
      {SUB_NAV.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`text-xs font-semibold uppercase tracking-widest pb-px transition-colors ${
              isActive
                ? "text-gold border-b-2 border-gold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

// ─── Page ─────────────────────────────────────────────────────────────────────

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
  const [recentTrades, setRecentTrades] = useState<TradeListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimatedFinalReleaseLabel = useState(
    () =>
      `Est. ${new Date(Date.now() + 14 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  )[0];

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [statsData, tradesData] = await Promise.all([
        api.trades.getStats(token),
        api.trades.list(token, { limit: 5 }),
      ]);
      setStats(statsData);
      setRecentTrades(tradesData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load asset data",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isAuthenticated && token) void fetchData();
  }, [isAuthenticated, token, fetchData]);

  // Derived values
  const vaultValue = stats?.totalVolume ?? 0;
  const escrowId = stats ? `${stats.totalTrades}-AX` : "8492-AX";
  const sequenceId = stats ? `${stats.openTrades}-AF` : "882-AF";

  const auditEntries = recentTrades?.items.slice(0, 3).map((trade, index) => ({
    type: (["biometric", "multi-sig", "ledger"] as const)[index % 3],
    title: `Trade ${trade.status.toLowerCase().replace(/_/g, " ")}`,
    metadata: `${new Date(trade.updatedAt).toLocaleString()} · ${trade.tradeId.slice(0, 8)}`,
  })) ?? [
    {
      type: "biometric" as const,
      title: "Biometric validation passed",
      metadata: "2m ago · 192.168.1.44",
    },
    {
      type: "multi-sig" as const,
      title: "Multi-sig request broadcast",
      metadata: "1h ago · ID: 494022",
    },
    {
      type: "ledger" as const,
      title: "Ledger synchronization",
      metadata: "Yesterday · Block 182,990",
    },
  ];

  const firstTrade = recentTrades?.items[0];

  return (
    /*
     * This page uses a custom two-column layout that sits inside the global
     * app shell (AppTopNav + AppSidebar). The AssetsSidebar is a secondary
     * contextual sidebar specific to the Assets section.
     */
    <div className="flex h-full min-h-full">
      {/* ── Assets contextual sidebar ── */}
      <AssetsSidebar
        shortAddress={shortAddress}
        isAuthenticated={isAuthenticated}
      />

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sub-nav bar */}
        <AssetsSubNav />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto bg-bg-primary">
          <div className="max-w-6xl mx-auto px-6 py-8 lg:px-10 space-y-6">
            {/* ── Auth / error banners ── */}
            {!isAuthenticated && !authLoading && (
              <div className="rounded-2xl border border-gold/20 bg-gold-muted px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gold">
                    Authentication required
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Connect your Freighter wallet to view live asset data.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={isWalletConnected ? authenticate : connectWallet}
                  disabled={authLoading}
                  className="shrink-0 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse hover:bg-gold-hover transition-colors disabled:opacity-60"
                >
                  {authLoading
                    ? "Loading…"
                    : isWalletConnected
                      ? "Sign In"
                      : "Connect Freighter"}
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-4 py-3 text-sm text-status-danger flex items-center justify-between">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-4 opacity-60 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}

            {/* ── Hero ── */}
            {loading && !stats ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-14 w-80" />
                <Skeleton className="h-10 w-64" />
              </div>
            ) : (
              <VaultHero
                escrowId={escrowId}
                custodyType={
                  isAuthenticated
                    ? "Institutional Custody"
                    : "Pending Wallet Authorization"
                }
                status={
                  isAuthenticated
                    ? stats?.openTrades
                      ? "Funds Locked"
                      : "No Active Trades"
                    : "Awaiting Wallet Link"
                }
                isSecured={isAuthenticated}
              />
            )}

            {/* ── Bento grid — Row 1: Release Sequence + Vault Value ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-8">
                {loading && !stats ? (
                  <Skeleton className="h-56 rounded-xl" />
                ) : (
                  <ReleaseSequenceCard
                    sequenceId={sequenceId}
                    steps={[
                      {
                        label: "Agreement",
                        date: stats
                          ? `${stats.totalTrades} trades`
                          : "Oct 12, 2023",
                        status: "completed",
                      },
                      {
                        label: "Audit Phase",
                        date: loading
                          ? "Loading…"
                          : stats?.openTrades
                            ? "Processing…"
                            : "Complete",
                        status: "in-progress",
                      },
                      {
                        label: "Final Release",
                        date: stats
                          ? estimatedFinalReleaseLabel
                          : "Est. Nov 04",
                        status: "pending",
                      },
                    ]}
                  />
                )}
              </div>

              <div className="lg:col-span-4">
                {loading && !stats ? (
                  <Skeleton className="h-56 rounded-xl" />
                ) : (
                  <VaultValueCard
                    value={vaultValue || 2480000}
                    currency="USD"
                    isInsured={isAuthenticated}
                    onReleaseFunds={() => undefined}
                  />
                )}
              </div>
            </div>

            {/* ── Bento grid — Row 2: Contract Manifest + Audit Log ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7">
                {loading && !recentTrades ? (
                  <Skeleton className="h-72 rounded-xl" />
                ) : (
                  <ContractManifestCard
                    contractId={firstTrade?.tradeId ?? "AMN-772-VLT-09"}
                    agreementDate={
                      firstTrade?.createdAt
                        ? new Date(firstTrade.createdAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            },
                          )
                        : "September 24, 2023"
                    }
                    settlementType="Immediate / Fiat-Backed"
                    originParty={{
                      initials: firstTrade?.buyerAddress
                        ? firstTrade.buyerAddress.slice(0, 2).toUpperCase()
                        : "GB",
                      name: firstTrade?.buyerAddress
                        ? `${firstTrade.buyerAddress.slice(0, 8)}…`
                        : "Global Biotech Inc.",
                      color: "teal",
                    }}
                    recipientParty={{
                      initials: firstTrade?.sellerAddress
                        ? firstTrade.sellerAddress.slice(0, 2).toUpperCase()
                        : "NS",
                      name: firstTrade?.sellerAddress
                        ? `${firstTrade.sellerAddress.slice(0, 8)}…`
                        : "Nova Solutions Ltd.",
                      color: "emerald",
                    }}
                    onExportPdf={() => undefined}
                    onViewClauses={() => undefined}
                  />
                )}
              </div>

              <div className="lg:col-span-5">
                {loading && !recentTrades ? (
                  <Skeleton className="h-72 rounded-xl" />
                ) : (
                  <AuditLogCard
                    entries={auditEntries}
                    isLiveSync={isAuthenticated}
                  />
                )}
              </div>
            </div>

            {/* ── Network Backbone ── */}
            <NetworkBackboneCard description="Secured and powered by the Stellar network for instantaneous cross-border settlement and verifiable transparency." />

            {/* ── Asset list table ── */}
            <div className="rounded-2xl border border-border-default bg-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">
                  Asset Positions
                </h2>
                <Link
                  href="/trades/create"
                  className="text-xs font-semibold text-gold hover:text-gold-hover transition-colors flex items-center gap-1"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M7 1v12M1 7h12" />
                  </svg>
                  New Asset
                </Link>
              </div>

              {loading && !recentTrades ? (
                <div className="px-4 py-4">
                  <SkeletonList rows={3} />
                </div>
              ) : recentTrades && recentTrades.items.length > 0 ? (
                <>
                  {/* Table header */}
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-bg-elevated text-xs font-medium text-text-muted uppercase tracking-wider border-b border-border-default">
                    <span>Asset / Trade ID</span>
                    <span>Amount</span>
                    <span>Counterparty</span>
                    <span>Status</span>
                    <span>Action</span>
                  </div>

                  {recentTrades.items.map((trade, i) => {
                    const statusLower = trade.status.toLowerCase();
                    const statusStyles: Record<string, string> = {
                      active: "text-status-success bg-emerald-muted",
                      pending: "text-status-warning bg-status-warning/15",
                      completed: "text-text-secondary bg-bg-elevated",
                      disputed: "text-status-danger bg-status-danger/15",
                      locked: "text-status-locked bg-gold-muted",
                    };
                    const pill =
                      statusStyles[statusLower] ??
                      "text-text-muted bg-bg-elevated";

                    return (
                      <div
                        key={trade.tradeId}
                        className={`grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 items-center px-6 py-4 border-b border-border-default last:border-0 transition-colors hover:bg-bg-elevated/40 ${
                          i % 2 === 0 ? "bg-bg-primary" : "bg-card"
                        }`}
                      >
                        {/* Asset ID */}
                        <div>
                          <Link
                            href={`/assets/${trade.tradeId}`}
                            className="text-sm font-mono text-gold hover:underline underline-offset-4 truncate block"
                          >
                            {trade.tradeId.slice(0, 12)}…
                          </Link>
                          <p className="text-xs text-text-muted mt-0.5">
                            {new Date(trade.createdAt).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </p>
                        </div>

                        {/* Amount */}
                        <p className="text-sm font-semibold text-text-primary">
                          {parseFloat(trade.amountCngn).toLocaleString()}{" "}
                          <span className="text-text-muted font-normal">
                            cNGN
                          </span>
                        </p>

                        {/* Counterparty */}
                        <p className="text-sm text-text-secondary font-mono truncate">
                          {trade.sellerAddress.slice(0, 6)}…
                          {trade.sellerAddress.slice(-4)}
                        </p>

                        {/* Status */}
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize w-fit ${pill}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                          {statusLower.replace(/_/g, " ")}
                        </span>

                        {/* Action */}
                        <Link
                          href={`/assets/${trade.tradeId}`}
                          className="text-xs font-semibold text-text-secondary hover:text-gold transition-colors whitespace-nowrap"
                        >
                          View →
                        </Link>
                      </div>
                    );
                  })}

                  {/* Footer link */}
                  <div className="px-6 py-3 flex justify-end border-t border-border-default">
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
                </>
              ) : (
                <div className="px-6 py-16 text-center">
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
                    No assets yet
                  </p>
                  <p className="text-xs text-text-secondary mt-1 mb-4">
                    {isAuthenticated
                      ? "Create your first trade to register an asset."
                      : "Connect your wallet to view assets."}
                  </p>
                  {isAuthenticated && (
                    <Link
                      href="/trades/create"
                      className="inline-block px-4 py-2 rounded-lg bg-gold text-text-inverse text-sm font-semibold hover:bg-gold-hover transition-colors"
                    >
                      Create Asset
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <VaultFooter
              version={FOOTER_CONTENT.version}
              links={FOOTER_CONTENT.links}
              socialLinks={FOOTER_CONTENT.socialLinks}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
