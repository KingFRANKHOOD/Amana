"use client";

interface TradeAmountRowProps {
  amountUsdc: string | number;
  amountLocal?: string | number;
  currencyLocal?: "NGN" | "XLM";
  label?: string;
  highlighted?: boolean;
}

function formatValue(value: string | number): string {
  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }

  return value;
}

function formatLocalAmount(
  value: string | number,
  currency: "NGN" | "XLM",
): string {
  const formatted = formatValue(value);

  if (currency === "NGN") {
    return `≈ ₦${formatted} NGN`;
  }

  return `≈ ${formatted} XLM`;
}

export function TradeAmountRow({
  amountUsdc,
  amountLocal,
  currencyLocal = "NGN",
  label = "Total Trade Value",
  highlighted = false,
}: TradeAmountRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border-default bg-elevated p-4">
      <div className="min-w-0">
        <p className="text-xs text-text-muted mb-1">{label}</p>
        <div className="flex items-end gap-2 flex-wrap">
          <p
            className={`font-mono text-3xl font-bold ${
              highlighted ? "text-gold" : "text-text-primary"
            }`}
          >
            {formatValue(amountUsdc)}
          </p>
          <span className="text-lg font-semibold text-text-muted">USDC</span>
        </div>
        {amountLocal !== undefined && (
          <p className="text-text-muted text-sm mt-1">
            {formatLocalAmount(amountLocal, currencyLocal)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-elevated border border-border-default rounded-full px-3 py-1.5 shrink-0">
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M2 5h9M11 3l2 2-2 2M14 11H5M5 9l-2 2 2 2" />
        </svg>
        <span className="whitespace-nowrap">Stellar Path Payment</span>
      </div>
    </div>
  );
}
