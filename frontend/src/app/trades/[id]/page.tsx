"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, TradeResponse } from "@/lib/api";

function BentoCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-text-muted">{title}</p>
      <p className="mt-3 text-lg font-semibold text-text-primary">{value}</p>
      <p className="mt-2 text-xs text-text-secondary">{helper}</p>
    </div>
  );
}



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
  const router = useRouter();
  const { token, isAuthenticated } = useAuth();
  const tradeId = params?.id ?? "UNKNOWN";

  const [trade, setTrade] = useState<TradeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTrade() {
      if (!isAuthenticated || !token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await api.trades.get(token, tradeId);
        setTrade(response);
      } catch (err) {
        let errorMessage = "Failed to load trade";
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

    fetchTrade();
  }, [token, isAuthenticated, tradeId]);

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Header with back button */}
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
        <div className="rounded-lg border border-status-danger/20 bg-red-500/10 px-4 py-3 text-center">
          <p className="text-status-danger text-sm">{error}</p>
        </div>
      )}

      {/* Trade details */}
      {!loading && !error && trade && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border-default bg-bg-card p-5">
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
            <BentoCard
              title="Amount"
              value={`${trade.amountUsdc} USDC`}
              helper="Total trade value"
            />
            <BentoCard
              title="Buyer"
              value={formatAddress(trade.buyerAddress)}
              helper="Buyer wallet address"
            />
            <BentoCard
              title="Seller"
              value={formatAddress(trade.sellerAddress)}
              helper="Seller wallet address"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BentoCard
              title="Buyer Loss Ratio"
              value={`${(trade.buyerLossBps / 100).toFixed(2)}%`}
              helper="Buyer's share of loss in basis points"
            />
            <BentoCard
              title="Seller Loss Ratio"
              value={`${(trade.sellerLossBps / 100).toFixed(2)}%`}
              helper="Seller's share of loss in basis points"
            />
          </div>
        </div>
      )}

      {/* Not found state */}
      {!loading && !error && !trade && (
        <div className="rounded-lg border border-border-default bg-bg-card p-8 text-center">
          <p className="text-text-muted">Trade not found</p>
        </div>
      )}
    </div>
  );
}
