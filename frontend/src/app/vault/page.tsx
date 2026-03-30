"use client";

import React, { useEffect, useState } from "react";

import {
  AuditLogCard,
  ContractManifestCard,
  ReleaseSequenceCard,
  VaultFooter,
  VaultHero,
  VaultValueCard,
} from "@/components/vault";
import { DriverManifestForm, type DriverManifestData } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, type TradeStatsResponse, type TradeListResponse } from "@/lib/api";

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

const PARTNERS = [
  "Stellar",
  "Mercury Custody",
  "Afrex Agro",
  "Chainproof",
  "Frontier Trade",
  "SiloBank",
];

export default function VaultPage() {
  const {
    address,
    shortAddress,
    token,
    isAuthenticated,
    isWalletConnected,
    isWalletDetected,
    isLoading: authLoading,
    connectWallet,
    authenticate,
  } = useAuth();

  const [stats, setStats] = useState<TradeStatsResponse | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isManifestOpen, setIsManifestOpen] = useState(false);
  const [manifestData, setManifestData] = useState<DriverManifestData | null>(null);

  const fetchVaultData = async () => {
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
      setError(err instanceof Error ? err.message : "Failed to load vault data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && token) {
      void fetchVaultData();
    }
  }, [isAuthenticated, token]);

  const walletStatus = authLoading
    ? "Checking wallet"
    : isAuthenticated
      ? "Authenticated"
      : isWalletConnected
        ? "Wallet linked"
        : isWalletDetected
          ? "Permission required"
          : "Freighter not detected";

  const vaultValue = stats?.totalVolume ?? 0;
  const escrowId = stats ? `${stats.totalTrades}-AX` : "0-AX";
  const sequenceId = stats ? `${stats.openTrades}-AF` : "0-AF";

  const auditEntries = recentTrades?.items.slice(0, 3).map((trade, index) => ({
    type: index === 0 ? "biometric" as const : index === 1 ? "multi-sig" as const : "ledger" as const,
    title: `Trade ${trade.status.toLowerCase().replace(/_/g, " ")}`,
    metadata: `${new Date(trade.updatedAt).toLocaleString()} - ${trade.tradeId}`,
  })) ?? [
    {
      type: "ledger" as const,
      title: "No recent activity",
      metadata: "Connect wallet to view",
    },
  ];

  return (
    <section className="min-h-full bg-bg-primary px-6 py-8 lg:px-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="rounded-2xl border border-border-default bg-card p-4 md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">
                Vault Identity
              </p>
              <p className="mt-1 text-sm text-text-primary">
                {shortAddress ?? "No connected wallet"}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs text-text-secondary">
                {walletStatus}
              </span>
              {!isAuthenticated && (
                <button
                  onClick={() => isWalletConnected ? authenticate() : connectWallet()}
                  disabled={authLoading}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {authLoading ? "Loading..." : isWalletConnected ? "Sign In" : "Connect Freighter"}
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-border-default bg-card p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-medium text-text-secondary">Driver/Vehicle Manifest</p>
            <button
              onClick={() => setIsManifestOpen(true)}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse transition-colors hover:bg-gold-hover"
            >
              Log Driver Details
            </button>
          </div>
          {manifestData && (
            <div className="mt-4 rounded-lg border border-border-default bg-bg-elevated p-3 text-sm text-text-primary">
              <p><strong>Driver:</strong> {manifestData.driverName}</p>
              <p><strong>Phone:</strong> {manifestData.driverPhone}</p>
              <p><strong>License:</strong> {manifestData.licensePlate}</p>
            </div>
          )}
        </div>

        <VaultHero
          escrowId={escrowId}
          custodyType={isAuthenticated ? "Institutional Custody" : "Pending Wallet Authorization"}
          status={isAuthenticated ? (stats?.openTrades ? "Funds Locked" : "No Active Trades") : "Awaiting Wallet Link"}
          isSecured={isAuthenticated}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="md:col-span-2 lg:col-span-2">
            <ReleaseSequenceCard
              sequenceId={sequenceId}
              steps={[
                { label: "Agreement", date: stats ? `${stats.totalTrades} trades` : "—", status: "completed" },
                {
                  label: "Active Trades",
                  date: isAuthenticated ? (loading ? "Loading..." : `${stats?.openTrades ?? 0} open`) : "Wallet pending",
                  status: "in-progress",
                },
                { label: "Total Volume", date: `$${vaultValue.toLocaleString()}`, status: "pending" },
              ]}
            />
          </div>

          <div>
            <VaultValueCard
              value={vaultValue}
              currency="USD"
              isInsured={isAuthenticated}
              onReleaseFunds={() => undefined}
            />
          </div>

          <div className="md:col-span-2 lg:col-span-2">
            <ContractManifestCard
              contractId={recentTrades?.items[0]?.tradeId ?? "No active trades"}
              agreementDate={recentTrades?.items[0]?.createdAt ? new Date(recentTrades.items[0].createdAt).toLocaleDateString() : "—"}
              settlementType="Immediate / Fiat-Backed"
              originParty={{
                initials: "BY",
                name: recentTrades?.items[0]?.buyerAddress ? `${recentTrades.items[0].buyerAddress.slice(0, 8)}...` : "Buyer",
                color: "teal",
              }}
              recipientParty={{
                initials: "SL",
                name: recentTrades?.items[0]?.sellerAddress ? `${recentTrades.items[0].sellerAddress.slice(0, 8)}...` : "Seller",
                color: "emerald",
              }}
              onExportPdf={() => undefined}
              onViewClauses={() => undefined}
            />
          </div>

          <div>
            <AuditLogCard
              entries={auditEntries}
              isLiveSync={isAuthenticated}
            />
          </div>

          <div className="md:col-span-2 lg:col-span-3 rounded-2xl border border-border-default bg-card p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-gold">Partner network</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {PARTNERS.map((partner) => (
                <div
                  key={partner}
                  className="rounded-xl border border-border-default bg-bg-elevated px-3 py-4 text-center text-sm font-medium text-text-secondary"
                >
                  {partner}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DriverManifestForm
          isOpen={isManifestOpen}
          onDismiss={() => setIsManifestOpen(false)}
          onComplete={(data) => {
            setManifestData(data);
            setIsManifestOpen(false);
          }}
        />

        <VaultFooter
          version={FOOTER_CONTENT.version}
          links={FOOTER_CONTENT.links}
          socialLinks={FOOTER_CONTENT.socialLinks}
        />
      </div>
    </section>
  );
}
