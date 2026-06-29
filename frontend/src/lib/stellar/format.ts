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
