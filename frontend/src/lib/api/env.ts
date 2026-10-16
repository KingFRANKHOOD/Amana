const DEFAULT_API_BASE_URL = "http://localhost:4000";
const DEFAULT_WALLET_BALANCE_REFRESH_MS = 30_000;

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE_URL;
}

/**
 * Poll interval (in milliseconds) for refreshing the connected wallet's
 * balances from Horizon.
 *
 * Overridable via `NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS` so operators can
 * tune polling per environment (e.g. slow it down to reduce load on
 * self-hosted Horizon nodes, or speed it up on testnet for demos) without a
 * code change. Invalid or non-positive values fall back to the 30s default.
 */
export function getWalletBalanceRefreshIntervalMs(): number {
  const raw = process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS;
  if (!raw) {
    return DEFAULT_WALLET_BALANCE_REFRESH_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WALLET_BALANCE_REFRESH_MS;
  }

  return parsed;
}

export function getStellarRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    "https://soroban-testnet.stellar.org"
  );
}

export function getStellarNetworkPassphrase(): string {
  return (
    process.env.NEXT_PUBLIC_STELLAR_NETWORK ||
    "Test SDF Network ; September 2015"
  );
}

export function getStellarHorizonUrl(network?: string | null): string {
  if (process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL) {
    return process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
  }

  return network?.toUpperCase() === "PUBLIC"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}
