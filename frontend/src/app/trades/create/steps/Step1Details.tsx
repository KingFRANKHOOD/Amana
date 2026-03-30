"use client";
import { useTrade } from "../TradeContext";

const COMMODITIES = ["Maize", "Rice", "Sorghum", "Millet", "Cassava", "Yam", "Groundnut", "Soybean"];
const UNITS = ["kg", "tonnes", "bags (50kg)", "bags (100kg)"];

export default function Step1Details() {
  const { data, update, setStep } = useTrade();

  const totalNGN =
    data.quantity && data.pricePerUnit
      ? (parseFloat(data.quantity) * parseFloat(data.pricePerUnit)).toLocaleString("en-NG")
      : "—";

  const valid =
    data.commodity && data.quantity && data.pricePerUnit && data.sellerAddress;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-secondary">Commodity</label>
        <select
          value={data.commodity}
          onChange={(e) => update({ commodity: e.target.value })}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
        >
          <option value="">Select commodity</option>
          {COMMODITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm text-text-secondary">Quantity</label>
          <input
            type="number"
            min="0"
            placeholder="e.g. 500"
            value={data.quantity}
            onChange={(e) => update({ quantity: e.target.value })}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          />
        </div>
        <div className="flex flex-col gap-1 w-36">
          <label className="text-sm text-text-secondary">Unit</label>
          <select
            value={data.unit}
            onChange={(e) => update({ unit: e.target.value })}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm text-text-secondary">Price per unit (NGN)</label>
          <input
            type="number"
            min="0"
            placeholder="e.g. 450"
            value={data.pricePerUnit}
            onChange={(e) => update({ pricePerUnit: e.target.value })}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          />
        </div>
        <div className="flex flex-col gap-1 w-28">
          <label className="text-sm text-text-secondary">Currency</label>
          <select
            value={data.currency}
            onChange={(e) => update({ currency: e.target.value })}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          >
            <option value="NGN">NGN</option>
            <option value="USDC">USDC</option>
          </select>
        </div>
      </div>

      {/* Total preview */}
      <div className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-3 border border-border-default">
        <span className="text-sm text-text-secondary">Estimated Total</span>
        <span className="text-gold font-semibold">
          {totalNGN !== "—" ? `${data.currency} ${totalNGN}` : "—"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-secondary">Seller Stellar Address</label>
        <input
          type="text"
          placeholder="G..."
          value={data.sellerAddress}
          onChange={(e) => update({ sellerAddress: e.target.value })}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary font-mono text-sm focus:outline-none focus:border-border-focus"
        />
      </div>

      <button
        disabled={!valid}
        onClick={() => setStep(2)}
        className="mt-2 h-12 rounded-full bg-gradient-gold-cta text-text-inverse font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue to Negotiation
      </button>
    </div>
  );
}
