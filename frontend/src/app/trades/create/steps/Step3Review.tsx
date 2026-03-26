"use client";
import { useState } from "react";
import { useTrade } from "../TradeContext";

// Simulates Soroban SDK tx submission — replace with real SDK call
async function submitToSoroban(data: object): Promise<string> {
  await new Promise((r) => setTimeout(r, 2500));
  // TODO: integrate @stellar/stellar-sdk / soroban-client here
  return `TX_HASH_${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
}

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
  const { data, setStep } = useTrade();
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total =
    data.quantity && data.pricePerUnit
      ? (parseFloat(data.quantity) * parseFloat(data.pricePerUnit)).toLocaleString("en-NG")
      : "—";

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const hash = await submitToSoroban(data);
      setTxHash(hash);
    } catch {
      setError("Transaction failed. Please try again.");
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
          <p className="text-xs text-text-muted mb-1">Transaction Hash</p>
          <p className="text-emerald font-mono text-sm break-all">{txHash}</p>
        </div>
        <a
          href="/trades"
          className="h-12 w-full flex items-center justify-center rounded-full bg-gradient-gold-cta text-text-inverse font-semibold"
        >
          View My Trades
        </a>
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
        <ReviewRow label="Seller Address" value={data.sellerAddress} />
        <ReviewRow label="Loss Ratio" value={`Buyer ${data.buyerRatio}% / Seller ${data.sellerRatio}%`} />
        <ReviewRow label="Delivery Window" value={`${data.deliveryDays} days`} />
        {data.notes && <ReviewRow label="Notes" value={data.notes} />}
      </div>

      <div className="rounded-lg bg-gold-muted border border-gold/20 px-4 py-3 text-sm text-gold">
        By submitting, you authorize a Stellar Path Payment converting {data.currency} to USDC,
        locked in the Amana escrow contract.
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
              Locking Funds…
            </>
          ) : (
            "Lock Funds & Create Trade"
          )}
        </button>
      </div>
    </div>
  );
}
