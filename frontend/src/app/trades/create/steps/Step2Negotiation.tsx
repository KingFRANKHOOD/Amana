"use client";
import { useTrade } from "../TradeContext";

export default function Step2Negotiation() {
  const { data, update, setStep } = useTrade();

  const handleBuyerRatio = (val: number) => {
    const clamped = Math.min(100, Math.max(0, val));
    update({ buyerRatio: clamped, sellerRatio: 100 - clamped });
  };

  const totalValue =
    data.quantity && data.pricePerUnit
      ? parseFloat(data.quantity) * parseFloat(data.pricePerUnit)
      : 0;

  const buyerLoss = totalValue ? ((data.buyerRatio / 100) * totalValue).toLocaleString("en-NG") : "—";
  const sellerLoss = totalValue ? ((data.sellerRatio / 100) * totalValue).toLocaleString("en-NG") : "—";

  return (
    <div className="flex flex-col gap-6">
      {/* Loss ratio */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">Loss Ratio (Buyer / Seller)</span>
          <span className="text-gold font-semibold text-sm">
            {data.buyerRatio}% / {data.sellerRatio}%
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={data.buyerRatio}
          onChange={(e) => handleBuyerRatio(parseInt(e.target.value))}
          className="w-full accent-gold"
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-bg-elevated border border-border-default px-4 py-3">
            <p className="text-xs text-text-muted mb-1">Buyer absorbs</p>
            <p className="text-text-primary font-semibold">{data.buyerRatio}%</p>
            {totalValue > 0 && (
              <p className="text-xs text-text-secondary mt-1">{data.currency} {buyerLoss}</p>
            )}
          </div>
          <div className="rounded-lg bg-bg-elevated border border-border-default px-4 py-3">
            <p className="text-xs text-text-muted mb-1">Seller absorbs</p>
            <p className="text-text-primary font-semibold">{data.sellerRatio}%</p>
            {totalValue > 0 && (
              <p className="text-xs text-text-secondary mt-1">{data.currency} {sellerLoss}</p>
            )}
          </div>
        </div>
      </div>

      {/* Delivery window */}
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-secondary">Delivery Window (days)</label>
        <input
          type="number"
          min="1"
          max="90"
          value={data.deliveryDays}
          onChange={(e) => update({ deliveryDays: e.target.value })}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
        />
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-secondary">Additional Terms / Notes</label>
        <textarea
          rows={3}
          placeholder="e.g. Goods must be bagged and sealed. Driver must present manifest."
          value={data.notes}
          onChange={(e) => update({ notes: e.target.value })}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary text-sm resize-none focus:outline-none focus:border-border-focus"
        />
      </div>

      {/* Info callout */}
      <div className="rounded-lg bg-emerald-muted border border-emerald/20 px-4 py-3 text-sm text-emerald">
        Funds will be locked as USDC via Stellar Path Payment from your NGN balance.
        The 1% platform fee is deducted on settlement.
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setStep(1)}
          className="flex-1 h-12 rounded-full border border-border-default text-text-secondary hover:border-border-hover transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => setStep(3)}
          className="flex-1 h-12 rounded-full bg-gradient-gold-cta text-text-inverse font-semibold"
        >
          Review Trade
        </button>
      </div>
    </div>
  );
}
