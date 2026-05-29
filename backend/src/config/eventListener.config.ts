/**
 * Configuration for the Soroban event listener service.
 * All values are overridable via environment variables.
 */

import { env } from './env';

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
  /** Maximum number of outbox processing attempts before dead-lettering */
  outboxMaxAttempts: number;
}

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';

export function getEventListenerConfig(): EventListenerConfig {
  return {
    rpcUrl: env.STELLAR_RPC_URL || DEFAULT_RPC_URL,
    contractId: env.AMANA_ESCROW_CONTRACT_ID,
    pollIntervalMs: env.EVENT_POLL_INTERVAL_MS,
    backoffInitialMs: env.BACKOFF_INITIAL_MS,
    backoffMaxMs: env.BACKOFF_MAX_MS,
    processedLedgersCacheSize: env.PROCESSED_LEDGERS_CACHE_SIZE,
    outboxMaxAttempts: env.EVENT_OUTBOX_MAX_ATTEMPTS,
  };
}
