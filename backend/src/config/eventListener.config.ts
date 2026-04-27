/**
 * Configuration for the Soroban event listener service.
 * All values are overridable via environment variables.
 */

export interface EventListenerConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Target contract ID to listen for events */
  contractId: string;
  /** Polling interval in milliseconds (default: 10000 for testnet) */
  pollIntervalMs: number;
  /** Initial backoff delay in milliseconds */
  backoffInitialMs: number;
  /** Maximum backoff delay in milliseconds */
  backoffMaxMs: number;
  /** Maximum number of processed ledgers to keep in memory */
  processedLedgersCacheSize: number;
}

export function getEventListenerConfig(): EventListenerConfig {
  return {
    rpcUrl: process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
    contractId: process.env.CONTRACT_ID || "",
    pollIntervalMs: parseInt(process.env.EVENT_POLL_INTERVAL_MS || "10000", 10),
    backoffInitialMs: parseInt(process.env.BACKOFF_INITIAL_MS || "1000", 10),
    backoffMaxMs: parseInt(process.env.BACKOFF_MAX_MS || "30000", 10),
    processedLedgersCacheSize: parseInt(process.env.PROCESSED_LEDGERS_CACHE_SIZE || "10000", 10),
  };
}
