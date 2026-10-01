"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StrKey } from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { useTrade } from "../TradeContext";
import { useAuth } from "@/hooks/useAuth";
import { api, apiConfig, ApiError } from "@/lib/api";
import Link from "next/link";
import { LegalDisclaimerModal } from "@/components/ui/LegalDisclaimerModal";

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
  const submittingRef = useRef(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const qty = parseFloat(data.quantity);
  const price = parseFloat(data.pricePerUnit);
  const rawAmount = !isNaN(qty) && !isNaN(price) ? qty * price : NaN;

  const total = !isNaN(rawAmount) && rawAmount > 0 ? rawAmount.toLocaleString("en-NG") : "—";

  const amountCngn = !isNaN(rawAmount) && rawAmount > 0 ? rawAmount.toFixed(7) : "0";

  const isAddressValid =
    data.sellerAddress !== "" &&
    StrKey.isValidEd25519PublicKey(data.sellerAddress.trim());
  const isFormValid =
    data.commodity !== "" &&
    !isNaN(qty) && qty > 0 &&
    !isNaN(price) && price > 0 &&
    !isNaN(rawAmount) && rawAmount > 0 &&
    isAddressValid &&
    data.buyerRatio + data.sellerRatio === 100;

  const buyerLossBps = Math.round(data.buyerRatio * 100);
  const sellerLossBps = Math.round(data.sellerRatio * 100);

  const handleDisclaimerAccept = () => {
    setShowDisclaimer(false);
    void handleSubmit();
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!isAuthenticated || !token) {
      setError("Please connect and authenticate your wallet first.");
      return;
    }

    if (!isFormValid) {
      setError("Please complete all required fields with valid values before submitting.");
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const createResponse = await api.trades.create(token, {
        sellerAddress: data.sellerAddress,
        amountUsdc: amountCngn,
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
      submittingRef.current = false;
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
        <Link
          href="/trades"
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          View All Trades
        </Link>
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
        <ReviewRow label="USDC Amount" value={`${amountCngn} cNGN`} />
        <ReviewRow label="Seller Address" value={data.sellerAddress} />
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setStep(2)}
          disabled={loading}
          className="h-12 flex-1 flex items-center justify-center rounded-full border border-border-default text-text-primary font-semibold disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={() => setShowDisclaimer(true)}
          disabled={loading || !isFormValid}
          className="h-12 flex-1 flex items-center justify-center rounded-full bg-gradient-gold-cta text-text-inverse font-semibold disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Trade"}
        </button>
      </div>

      <LegalDisclaimerModal
        isOpen={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        onAccept={handleDisclaimerAccept}
      />
    </div>
  );
}
