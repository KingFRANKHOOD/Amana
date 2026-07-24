// 1 XLM or 1 USDC = 10_000_000 stroops on Stellar

export function formatStroops(stroops: number, decimals: number): string {
  const divisor = Math.pow(10, decimals);
  const whole = Math.floor(stroops / divisor);
  const frac = stroops % divisor;
  return `${whole.toLocaleString("en-US")}.${String(frac).padStart(decimals, "0")}`;
}

export function formatUsdc(stroops: number): string {
  const totalCents = Math.round(stroops / 100_000);
  const dollars = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  return `$${dollars.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
}

export function formatXlm(stroops: number): string {
  const tenThousandths = Math.round(stroops / 1_000);
  const whole = Math.floor(tenThousandths / 10_000);
  const frac = tenThousandths % 10_000;
  return `${whole.toLocaleString("en-US")}.${String(frac).padStart(4, "0")} XLM`;
}

export type CurrencyCode = "USD" | "NGN" | "EUR" | "GBP";

const CURRENCY_LOCALE_MAP: Record<CurrencyCode, string> = {
  USD: "en-US",
  NGN: "en-NG",
  EUR: "de-DE",
  GBP: "en-GB",
};

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: "$",
  NGN: "\u20a6",
  EUR: "\u20ac",
  GBP: "\u00a3",
};

/**
 * Format a numeric amount with the appropriate currency symbol and locale.
 * Uses Intl.NumberFormat for locale-aware grouping and decimal separators.
 */
export function formatCurrency(
  amount: number,
  currency: CurrencyCode = "USD",
  options?: { compact?: boolean },
): string {
  const locale = CURRENCY_LOCALE_MAP[currency];
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...(options?.compact ? { notation: "compact", compactDisplay: "short" } : {}),
  });
  return formatter.format(amount);
}

/**
 * Format a USDC amount (input in stroops / 10_000_000) using locale-aware formatting.
 */
export function formatUsdcLocale(
  stroops: number,
  currency: CurrencyCode = "USD",
): string {
  const totalCents = Math.round(stroops / 100_000);
  const dollars = totalCents / 100;
  return formatCurrency(dollars, currency);
}

/**
 * Format a cNGN amount using locale-aware formatting.
 */
export function formatCngnLocale(amount: number): string {
  return formatCurrency(amount, "NGN");
}

export { CURRENCY_SYMBOLS };
