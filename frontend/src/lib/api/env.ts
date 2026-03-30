const DEFAULT_API_BASE_URL = "http://localhost:4000";

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE_URL;
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
