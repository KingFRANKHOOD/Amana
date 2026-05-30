export const TOKEN_CONFIG = {
  symbol: "cNGN",
  decimals: 7,
  name: "Amana Stablecoin",
};

/** BigInt decimals constant for fixed-point arithmetic. */
export const TOKEN_DECIMALS = BigInt(TOKEN_CONFIG.decimals);

/** Shared BigInt base for fixed-point arithmetic (10^7 = 10_000_000). */
export const TOKEN_BASE = 10n ** TOKEN_DECIMALS;
