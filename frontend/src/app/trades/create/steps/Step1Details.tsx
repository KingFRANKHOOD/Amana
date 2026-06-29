"use client";
import { useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { useTrade } from "../TradeContext";
import { validateStep1 } from "../validation";

const COMMODITIES = ["Maize", "Rice", "Sorghum", "Millet", "Cassava", "Yam", "Groundnut", "Soybean"];
const UNITS = ["kg", "tonnes", "bags (50kg)", "bags (100kg)"];

export default function Step1Details() {
  const { data, update, setStep } = useTrade();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const qty = parseFloat(data.quantity);
  const price = parseFloat(data.pricePerUnit);
  const totalValue = !isNaN(qty) && !isNaN(price) ? qty * price : NaN;

  const totalNGN = !isNaN(totalValue) ? totalValue.toLocaleString("en-NG") : "—";

  const isQtyValid = data.quantity !== "" && !isNaN(qty) && qty > 0;
  const isPriceValid = data.pricePerUnit !== "" && !isNaN(price) && price > 0;
  const isAddressValid =
    data.sellerAddress !== "" &&
    StrKey.isValidEd25519PublicKey(data.sellerAddress.trim());

  const valid =
    data.commodity !== "" && isQtyValid && isPriceValid && isAddressValid;

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const errs = validateStep1(data as unknown as Record<string, unknown>);
    setErrors((prev) => ({
      ...prev,
      [field]: errs[field] || "",
    }));
  };

  const handleContinue = () => {
    const allTouched: Record<string, boolean> = {};
    for (const key of ["commodity", "quantity", "unit", "pricePerUnit", "currency", "sellerAddress"]) {
      allTouched[key] = true;
    }
    setTouched(allTouched);
    const errs = validateStep1(data as unknown as Record<string, unknown>);
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setStep(2);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="commodity" className="text-sm text-text-secondary">Commodity</label>
        <select
          id="commodity"
          value={data.commodity}
          onChange={(e) => { update({ commodity: e.target.value }); setErrors((prev) => ({ ...prev, commodity: "" })); }}
          onBlur={() => handleBlur("commodity")}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
        >
          <option value="">Select commodity</option>
          {COMMODITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {errors.commodity && touched.commodity && <p className="text-status-danger text-xs mt-1">{errors.commodity}</p>}
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="quantity" className="text-sm text-text-secondary">Quantity</label>
          <input
            id="quantity"
            type="number"
            min="0"
            placeholder="e.g. 500"
            value={data.quantity}
            onChange={(e) => { update({ quantity: e.target.value }); setErrors((prev) => ({ ...prev, quantity: "" })); }}
            onBlur={() => handleBlur("quantity")}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          />
          {errors.quantity && touched.quantity && <p className="text-status-danger text-xs mt-1">{errors.quantity}</p>}
        </div>
        <div className="flex flex-col gap-1 w-36">
          <label htmlFor="unit" className="text-sm text-text-secondary">Unit</label>
          <select
            id="unit"
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
          <label htmlFor="price-per-unit" className="text-sm text-text-secondary">Price per unit (NGN)</label>
          <input
            id="price-per-unit"
            type="number"
            min="0"
            placeholder="e.g. 450"
            value={data.pricePerUnit}
            onChange={(e) => { update({ pricePerUnit: e.target.value }); setErrors((prev) => ({ ...prev, pricePerUnit: "" })); }}
            onBlur={() => handleBlur("pricePerUnit")}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          />
          {errors.pricePerUnit && touched.pricePerUnit && <p className="text-status-danger text-xs mt-1">{errors.pricePerUnit}</p>}
        </div>
        <div className="flex flex-col gap-1 w-28">
          <label htmlFor="currency" className="text-sm text-text-secondary">Currency</label>
          <select
            id="currency"
            value={data.currency}
            onChange={(e) => update({ currency: e.target.value })}
            className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary focus:outline-none focus:border-border-focus"
          >
            <option value="NGN">NGN</option>
            <option value="cNGN">USDC</option>
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
        <label htmlFor="seller-address" className="text-sm text-text-secondary">Seller Stellar Address</label>
        <input
          id="seller-address"
          type="text"
          placeholder="G..."
          value={data.sellerAddress}
          onChange={(e) => { update({ sellerAddress: e.target.value.trim() }); setErrors((prev) => ({ ...prev, sellerAddress: "" })); }}
          onBlur={() => handleBlur("sellerAddress")}
          className="bg-bg-input border border-border-default rounded-md px-4 py-3 text-text-primary font-mono text-sm focus:outline-none focus:border-border-focus"
        />
        {errors.sellerAddress && touched.sellerAddress && <p className="text-status-danger text-xs mt-1">{errors.sellerAddress}</p>}
      </div>

      <button
        disabled={!valid}
        onClick={handleContinue}
        className="mt-2 h-12 rounded-full bg-gradient-gold-cta text-text-inverse font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue to Negotiation
      </button>
    </div>
  );
}
