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

export function getStellarHorizonUrl(network?: string | null): string {
  if (process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL) {
    return process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
  }

  return network?.toUpperCase() === "PUBLIC"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

export function getStellarNetworkFromPassphrase(
  networkPassphrase: string,
): "PUBLIC" | "TESTNET" {
  return networkPassphrase.includes("Test") ? "TESTNET" : "PUBLIC";
}

export function getStellarExplorerTxUrl(
  networkPassphrase: string,
  txHash: string,
): string {
  const segment =
    getStellarNetworkFromPassphrase(networkPassphrase) === "PUBLIC"
      ? "public"
      : "testnet";
  return `https://stellar.expert/explorer/${segment}/tx/${txHash}`;
}
