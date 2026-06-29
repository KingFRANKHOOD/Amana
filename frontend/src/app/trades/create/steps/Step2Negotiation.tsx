"use client";
import { useState } from "react";
import { useTrade } from "../TradeContext";
import { validateStep2 } from "../validation";

export default function Step2Negotiation() {
  const { data, update, setStep } = useTrade();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleBuyerRatio = (val: number) => {
    const clamped = Math.min(100, Math.max(0, val));
    update({ buyerRatio: clamped, sellerRatio: 100 - clamped });
    setErrors((prev) => ({ ...prev, sum: "", buyerRatio: "", sellerRatio: "" }));
  };

  const totalValue =
    data.quantity && data.pricePerUnit
      ? parseFloat(data.quantity) * parseFloat(data.pricePerUnit)
      : 0;

  const buyerLoss = totalValue ? ((data.buyerRatio / 100) * totalValue).toLocaleString("en-NG") : "—";
  const sellerLoss = totalValue ? ((data.sellerRatio / 100) * totalValue).toLocaleString("en-NG") : "—";

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const errs = validateStep2({
      buyerRatio: data.buyerRatio,
      sellerRatio: data.sellerRatio,
      deliveryDays: data.deliveryDays,
    });
    setErrors((prev) => ({
      ...prev,
      [field]: errs[field] || "",
    }));
  };

  const handleReview = () => {
    const allTouched: Record<string, boolean> = {};
    for (const key of ["buyerRatio", "sellerRatio", "deliveryDays"]) {
      allTouched[key] = true;
    }
    setTouched(allTouched);
    const errs = validateStep2({
      buyerRatio: data.buyerRatio,
      sellerRatio: data.sellerRatio,
      deliveryDays: data.deliveryDays,
    });
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setStep(3);
    }
  };

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
        {errors.sum && touched.buyerRatio && <p className="text-status-danger text-xs text-center">{errors.sum}</p>}
      </div>

      {/* Delivery window */}
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-secondary">Delivery Window (days)</label>
        <input
          type="number"
          min="1"
          max="90"
          value={data.deliveryDays}
          onChange={(e) => {
            const raw = parseInt(e.target.value);
            const clamped = isNaN(raw) ? 1 : Math.min(90, Math.max(1, raw));
            update({ deliveryDays: String(clamped) });
            setErrors((prev) => ({ ...prev, deliveryDays: "" }));
          }}
          onBlur={() => handleBlur("deliveryDays")}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
        />
        {errors.deliveryDays && touched.deliveryDays && <p className="text-status-danger text-xs mt-1">{errors.deliveryDays}</p>}
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
        Funds will be locked as cNGN via Stellar Path Payment from your NGN balance.
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
          onClick={handleReview}
          className="flex-1 h-12 rounded-full bg-gradient-gold-cta text-text-inverse font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Review Trade
        </button>
      </div>
    </div>
  );
}
