"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TradeDetailPanel } from "@/components/trade/TradeDetailPanel";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, type TradeResponse, type TradeHistoryEvent } from "@/lib/api";
import type { TradeDetail, TimelineEvent, TransactionEvent } from "@/types/trade";

function mapStatusToDisplay(status: string): TradeDetail["status"] {
  const statusMap: Record<string, TradeDetail["status"]> = {
    PENDING_SIGNATURE: "PENDING",
    CREATED: "PENDING",
    FUNDED: "IN TRANSIT",
    DELIVERED: "IN TRANSIT",
    SETTLED: "SETTLED",
    DISPUTED: "DISPUTED",
    CANCELLED: "DRAFT",
  };
  return statusMap[status] || "PENDING";
}

function mapHistoryToTimeline(events: TradeHistoryEvent[]): TimelineEvent[] {
  return events.map((event, index) => ({
    id: String(index + 1),
    type: event.eventType as TimelineEvent["type"],
    title: event.eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: JSON.stringify(event.metadata),
    timestamp: new Date(event.timestamp).toLocaleString(),
    status: index === events.length - 1 ? "current" : "completed",
  }));
}

function mapHistoryToTransactionTimeline(events: TradeHistoryEvent[]): TransactionEvent[] {
  return events.map((event, index) => ({
    id: `tx-${index + 1}`,
    title: event.eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    actor: (event.actor || "system") as TransactionEvent["actor"],
    timestamp: new Date(event.timestamp).toLocaleString(),
    description: JSON.stringify(event.metadata),
    status: "completed",
  }));
}

function buildTradeDetail(
  trade: TradeResponse,
  history: TradeHistoryEvent[]
): TradeDetail {
  const timeline = mapHistoryToTimeline(history);
  const transactionTimeline = mapHistoryToTransactionTimeline(history);

  return {
    id: trade.tradeId,
    commodity: "Trade",
    quantity: `${trade.amountUsdc} USDC`,
    category: "Escrow Trade",
    status: mapStatusToDisplay(trade.status),
    initiatedAt: new Date(trade.createdAt).toLocaleDateString(),
    buyer: {
      name: "Buyer",
      walletAddress: `${trade.buyerAddress.slice(0, 6)}...${trade.buyerAddress.slice(-4)}`,
      trustScore: 100,
    },
    seller: {
      name: "Seller",
      walletAddress: `${trade.sellerAddress.slice(0, 6)}...${trade.sellerAddress.slice(-4)}`,
      trustScore: 100,
    },
    vaultAmountLocked: Number(trade.amountUsdc),
    assetValue: Number(trade.amountUsdc) * 0.99,
    platformFeePercent: 1,
    platformFee: Number(trade.amountUsdc) * 0.01,
    networkGasEst: "0.01",
    contractId: trade.tradeId,
    incoterms: "FOB",
    originPort: "Origin",
    destinationPort: "Destination",
    eta: "TBD",
    etaLabel: "Pending",
    carrier: "TBD",
    timeline: timeline.length > 0 ? timeline : [
      {
        id: "1",
        type: "escrow_funded",
        title: "Trade Created",
        description: "Trade has been created and awaiting funding.",
        status: trade.status === "PENDING_SIGNATURE" ? "current" : "completed",
      },
    ],
    transactionTimeline: transactionTimeline.length > 0 ? transactionTimeline : undefined,
    currentTransactionIndex: transactionTimeline.length > 0 ? transactionTimeline.length - 1 : 0,
    lossRatios: [
      { label: "Buyer Loss", value: trade.buyerLossBps / 100 },
      { label: "Seller Loss", value: trade.sellerLossBps / 100 },
    ],
  };
}

function LoadingState() {
  return (
    <div className="min-h-screen bg-primary flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-gold border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-text-secondary">Loading trade details...</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="min-h-screen bg-primary flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 rounded-full bg-status-danger/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-status-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Error</h2>
        <p className="text-text-secondary mb-4">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-gold text-text-inverse rounded-lg font-medium hover:bg-gold-hover"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}

function AuthRequired({ onConnect, onAuthenticate, isConnected, isLoading }: {
  onConnect: () => void;
  onAuthenticate: () => void;
  isConnected: boolean;
  isLoading: boolean;
}) {
  return (
    <div className="min-h-screen bg-primary flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Authentication Required</h2>
        <p className="text-text-secondary mb-4">
          {isConnected
            ? "Please sign in with your wallet to view trade details."
            : "Connect your Freighter wallet to view trade details."}
        </p>
        <button
          onClick={isConnected ? onAuthenticate : onConnect}
          disabled={isLoading}
          className="px-4 py-2 bg-gold text-text-inverse rounded-lg font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          {isLoading ? "Loading..." : isConnected ? "Sign In" : "Connect Wallet"}
        </button>
      </div>
    </div>
  );
}

export default function TradeDetailPage() {
  const params = useParams();
  const tradeId = params.id as string;
  const { token, isAuthenticated, isWalletConnected, isLoading: authLoading, connectWallet, authenticate } = useAuth();

  const [trade, setTrade] = useState<TradeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrade = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const [tradeData, historyData] = await Promise.all([
        api.trades.get(token, tradeId),
        api.trades.getHistory(token, tradeId).catch(() => ({ events: [] })),
      ]);

      const tradeDetail = buildTradeDetail(tradeData, historyData.events);
      setTrade(tradeDetail);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError("Trade not found.");
        } else if (err.status === 403) {
          setError("You do not have access to this trade.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Failed to load trade details.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && token) {
      void fetchTrade();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, token, tradeId]);

  if (authLoading) {
    return <LoadingState />;
  }

  if (!isAuthenticated) {
    return (
      <AuthRequired
        onConnect={connectWallet}
        onAuthenticate={authenticate}
        isConnected={isWalletConnected}
        isLoading={authLoading}
      />
    );
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchTrade} />;
  }

  if (!trade) {
    return <ErrorState message="Trade not found." />;
  }

  return <TradeDetailPanel trade={trade} />;
}
