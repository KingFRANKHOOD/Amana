"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { BentoCard } from "@/components/ui/BentoCard";

interface PaymentOverviewCardProps {
  totalUsdc: number;
  ngnRate?: number;
}

interface CostLineItem {
  label: string;
  getValue: (total: number, currency: "USDC" | "NGN", rate: number) => string;
  dimmed?: boolean;
}

const LINE_ITEMS: CostLineItem[] = [
  {
    label: "Total Trade Value",
    getValue: (total, currency, rate) =>
      currency === "NGN"
        ? `₦${(total * rate).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
        : `${total.toLocaleString()} USDC`,
  },
  {
    label: "Amana Platform Fee (1%)",
    getValue: (total, currency, rate) => {
      const fee = parseFloat((total * 0.01).toFixed(2));
      return currency === "NGN"
        ? `₦${(fee * rate).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
        : `${fee.toLocaleString()} USDC`;
    },
  },
  {
    label: "Net Payout",
    getValue: (total, currency, rate) => {
      const net = parseFloat((total - total * 0.01).toFixed(2));
      return currency === "NGN"
        ? `₦${(net * rate).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
        : `${net.toLocaleString()} USDC`;
    },
    dimmed: true,
  },
];

export function PaymentOverviewCard({
  totalUsdc,
  ngnRate = 1580,
}: PaymentOverviewCardProps) {
  const [currency, setCurrency] = useState<"USDC" | "NGN">("USDC");

  const lockedDisplay =
    currency === "NGN"
      ? `₦${(totalUsdc * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
      : `${totalUsdc.toLocaleString()} USDC`;

  return (
    <BentoCard
      title="Vault Escrow Summary"
      icon={<CreditCard className="w-5 h-5" />}
      glowVariant="gold"
      className="h-full"
    >
      <div className="flex items-center justify-end -mt-8 mb-5">
        <div className="flex items-center gap-1 bg-bg-elevated rounded-full p-1">
          {(["USDC", "NGN"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                currency === c
                  ? "bg-gold text-text-inverse"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-0 divide-y divide-border-default">
        {LINE_ITEMS.map(({ label, getValue, dimmed }) => (
          <div key={label} className="flex items-center justify-between py-3">
            <span
              className={`text-sm ${dimmed ? "text-text-muted" : "text-text-secondary"}`}
            >
              {label}
            </span>
            <span className="text-sm font-semibold text-text-primary">
              {getValue(totalUsdc, currency, ngnRate)}
            </span>
          </div>
        ))}
      </div>

      <div className="bg-gold-muted/20 border-l-[3px] border-gold text-gold font-bold px-4 py-2 mt-4 rounded-r-md flex items-center justify-between">
        <span className="text-sm">Locked in USDC</span>
        <span className="text-sm">{lockedDisplay}</span>
      </div>
    </BentoCard>
  );
}
