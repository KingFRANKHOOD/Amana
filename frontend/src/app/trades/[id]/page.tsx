"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useTradeDetails } from "@/hooks/useTradeDetails";
import { BentoCard } from "@/components/ui";

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function TradeDetailPage() {
  const params = useParams<{ id: string }>();
  const { token } = useAuth();
  const tradeId = params?.id ?? "UNKNOWN";

  const { trade, loading, error } = useTradeDetails(token, tradeId);

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          Trade Details
        </h1>
        <Link
          href="/trades"
          className="px-3 py-1.5 rounded-md border border-border-default hover:border-border-hover text-text-secondary hover:text-text-primary transition-colors"
        >
          Back to Trades
        </Link>
      </div>

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

      {error && !loading && (
        <div className="rounded-lg border border-status-danger/20 bg-red-500/10 px-4 py-3 text-center">
          <p className="text-status-danger text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && trade && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border-default bg-bg-card dark:bg-surface-1 p-5">
            <p className="text-xs uppercase tracking-wide text-text-muted">
              Trade ID
            </p>
            <p className="mt-2 text-xl font-semibold text-text-primary font-mono">
              {trade.tradeId}
            </p>
            <p className="mt-3 text-sm text-text-secondary">
              Status:{" "}
              <span className="font-medium capitalize">{trade.status}</span>
            </p>
            <p className="mt-2 text-xs text-text-muted">
              Created: {formatDate(trade.createdAt)}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BentoCard title="Amount">
              <p className="text-lg font-semibold text-text-primary">{`${trade.amountCngn} cNGN`}</p>
              <p className="mt-1 text-xs text-text-secondary">Total trade value</p>
            </BentoCard>
            <BentoCard title="Buyer">
              <p className="text-lg font-semibold text-text-primary font-mono">
                {formatAddress(trade.buyerAddress)}
              </p>
              <p className="mt-1 text-xs text-text-secondary">Buyer wallet address</p>
            </BentoCard>
            <BentoCard title="Seller">
              <p className="text-lg font-semibold text-text-primary font-mono">
                {formatAddress(trade.sellerAddress)}
              </p>
              <p className="mt-1 text-xs text-text-secondary">Seller wallet address</p>
            </BentoCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BentoCard title="Buyer Loss Ratio">
              <p className="text-lg font-semibold text-text-primary">
                {`${(trade.buyerLossBps / 100).toFixed(2)}%`}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Buyer&apos;s share of loss in basis points
              </p>
            </BentoCard>
            <BentoCard title="Seller Loss Ratio">
              <p className="text-lg font-semibold text-text-primary">
                {`${(trade.sellerLossBps / 100).toFixed(2)}%`}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Seller&apos;s share of loss in basis points
              </p>
            </BentoCard>
          </div>
        </div>
      )}

      {!loading && !error && !trade && (
        <div className="rounded-lg border border-border-default bg-bg-card dark:bg-surface-1 p-8 text-center">
          <p className="text-text-muted">Trade not found</p>
        </div>
      )}
    </div>
  );
}
