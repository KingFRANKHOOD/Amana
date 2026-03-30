"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signTransaction } from "@stellar/freighter-api";
import { useTrade } from "../TradeContext";
import { useAuth } from "@/hooks/useAuth";
import { api, apiConfig, ApiError } from "@/lib/api";

type Row = { label: string; value: string };

function ReviewRow({ label, value }: Row) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-default last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm text-text-primary font-medium text-right max-w-[60%] break-all">{value}</span>
    </div>
  );
}

export default function Step3Review() {
  const router = useRouter();
  const { data, setStep } = useTrade();
  const { token, isAuthenticated, connectWallet, authenticate, isWalletConnected } = useAuth();
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total =
    data.quantity && data.pricePerUnit
      ? (parseFloat(data.quantity) * parseFloat(data.pricePerUnit)).toLocaleString("en-NG")
      : "—";

  const amountUsdc =
    data.quantity && data.pricePerUnit
      ? String(parseFloat(data.quantity) * parseFloat(data.pricePerUnit))
      : "0";

  const buyerLossBps = Math.round(data.buyerRatio * 100);
  const sellerLossBps = Math.round(data.sellerRatio * 100);

  const handleSubmit = async () => {
    if (!isAuthenticated || !token) {
      setError("Please connect and authenticate your wallet first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const createResponse = await api.trades.create(token, {
        sellerAddress: data.sellerAddress,
        amountUsdc,
        buyerLossBps,
        sellerLossBps,
      });

      setTradeId(createResponse.tradeId);

      const signResult = await signTransaction(createResponse.unsignedXdr, {
        networkPassphrase: apiConfig.getStellarNetworkPassphrase(),
      });

      if (signResult.error !== undefined) {
        throw new Error(signResult.error.message || "Failed to sign transaction");
      }

      const signedXdr = signResult.signedTxXdr;

      const rpcUrl = apiConfig.getStellarRpcUrl();
      const submitResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: { transaction: signedXdr },
        }),
      });

      const submitResult = await submitResponse.json();

      if (submitResult.error) {
        throw new Error(submitResult.error.message || "Transaction submission failed");
      }

      setTxHash(submitResult.result?.hash || createResponse.tradeId);
    } catch (err) {
      let errorMessage = "Transaction failed. Please try again.";
      if (err instanceof ApiError) {
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (txHash) {
    return (
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-muted flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <p className="text-text-primary font-semibold text-lg">Trade Created</p>
          <p className="text-text-secondary text-sm mt-1">Funds locked in escrow vault</p>
        </div>
        <div className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3 text-left">
          <p className="text-xs text-text-muted mb-1">Trade ID</p>
          <p className="text-emerald font-mono text-sm break-all">{tradeId}</p>
        </div>
        <div className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3 text-left">
          <p className="text-xs text-text-muted mb-1">Transaction Hash</p>
          <p className="text-emerald font-mono text-sm break-all">{txHash}</p>
        </div>
        <button
          onClick={() => router.push(`/trades/${tradeId}`)}
          className="h-12 w-full flex items-center justify-center rounded-full bg-gradient-gold-cta text-text-inverse font-semibold"
        >
          View Trade Details
        </button>
        <a
          href="/trades"
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          View All Trades
        </a>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <p className="text-text-primary font-semibold text-lg">Authentication Required</p>
          <p className="text-text-secondary text-sm mt-1">
            {isWalletConnected
              ? "Sign in with your wallet to create trades."
              : "Connect your Freighter wallet to create trades."}
          </p>
        </div>
        <button
          onClick={() => isWalletConnected ? authenticate() : connectWallet()}
          disabled={loading}
          className="h-12 w-full flex items-center justify-center rounded-full bg-gradient-gold-cta text-text-inverse font-semibold disabled:opacity-50"
        >
          {isWalletConnected ? "Sign In" : "Connect Wallet"}
        </button>
        <button
          onClick={() => setStep(2)}
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg bg-bg-elevated border border-border-default px-4 divide-y divide-border-default">
        <ReviewRow label="Commodity" value={data.commodity} />
        <ReviewRow label="Quantity" value={`${data.quantity} ${data.unit}`} />
        <ReviewRow label="Price per unit" value={`${data.currency} ${data.pricePerUnit}`} />
        <ReviewRow label="Total Value" value={`${data.currency} ${total}`} />
        <ReviewRow label="USDC Amount" value={`${amountUsdc} USDC`} />
        <ReviewRow label="Seller Address" value={data.sellerAddress} />
        <ReviewRow label="Loss Ratio" value={`Buyer ${data.buyerRatio}% / Seller ${data.sellerRatio}%`} />
        <ReviewRow label="Delivery Window" value={`${data.deliveryDays} days`} />
        {data.notes && <ReviewRow label="Notes" value={data.notes} />}
      </div>

      <div className="rounded-lg bg-gold-muted border border-gold/20 px-4 py-3 text-sm text-gold">
        By submitting, you authorize a Stellar transaction to create an escrow trade,
        locking {amountUsdc} USDC in the Amana escrow contract.
      </div>

      {error && (
        <p className="text-status-danger text-sm text-center">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          disabled={loading}
          onClick={() => setStep(2)}
          className="flex-1 h-12 rounded-full border border-border-default text-text-secondary hover:border-border-hover transition-colors disabled:opacity-40"
        >
          Back
        </button>
        <button
          disabled={loading}
          onClick={handleSubmit}
          className="flex-1 h-12 rounded-full bg-gradient-gold-cta text-text-inverse font-semibold disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              Creating Trade...
            </>
          ) : (
            "Lock Funds & Create Trade"
          )}
        </button>
      </div>
    </div>
  );
}
