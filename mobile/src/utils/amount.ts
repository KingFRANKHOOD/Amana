/**
 * Mirrors backend/src/schemas/trade.schemas.ts createTradeSchema.amountUsdc:
 * a non-negative decimal with at most 7 fractional digits (Stellar precision).
 * Guarded by utils/__tests__/amount.test.ts, which fails if the backend
 * regex changes without this copy being updated.
 */
export const AMOUNT_USDC_PATTERN = /^\d+(\.\d{1,7})?$/;
export const AMOUNT_DECIMALS = 7;

/**
 * Compute qty * price as an amount string the backend accepts.
 * Floating-point products like 1.1 * 3.001 carry >7 decimals, so round to
 * 7 places (same as the web flow's Step3Review) and drop trailing zeros.
 * Returns '0' for invalid, non-positive or non-finite input.
 */
export function computeTradeAmount(quantity: string, pricePerUnit: string): string {
  const qty = parseFloat(quantity);
  const price = parseFloat(pricePerUnit);
  const raw = qty * price;
  if (!Number.isFinite(raw) || raw <= 0) return '0';

  const fixed = raw.toFixed(AMOUNT_DECIMALS);
  // toFixed switches to exponent notation above 1e21; reject rather than send garbage.
  if (!AMOUNT_USDC_PATTERN.test(fixed)) return '0';

  return fixed.replace(/\.?0+$/, '');
}
