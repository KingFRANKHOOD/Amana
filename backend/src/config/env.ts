import { z } from 'zod';

function normalizeEnvInput(raw: Record<string, string | undefined>): Record<string, string | undefined> {
  const normalized = { ...raw };

  if (!normalized.AMANA_ESCROW_CONTRACT_ID && normalized.CONTRACT_ID) {
    normalized.AMANA_ESCROW_CONTRACT_ID = normalized.CONTRACT_ID;
  }

  if (!normalized.STELLAR_RPC_URL && normalized.SOROBAN_RPC_URL) {
    normalized.STELLAR_RPC_URL = normalized.SOROBAN_RPC_URL;
  }

  if (normalized.STELLAR_NETWORK) {
    normalized.STELLAR_NETWORK = normalized.STELLAR_NETWORK.toLowerCase();
  }

  return normalized;
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'staging', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('86400'),
  JWT_ISSUER: z.string().default('amana'),
  JWT_AUDIENCE: z.string().default('amana-api'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CORS_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  API_PUBLIC_URL: z.string().url().optional(),

  // Stellar / Soroban
  STELLAR_NETWORK: z
    .string()
    .default('testnet')
    .transform((value: string) => (value.toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet')),
  STELLAR_NETWORK_PASSPHRASE: z.string().optional(),
  STELLAR_RPC_URL: z.string().optional(),
  SOROBAN_RPC_URL: z.string().optional(),
  /** @deprecated Use AMANA_ESCROW_CONTRACT_ID */
  CONTRACT_ID: z.string().min(1).optional(),
  AMANA_ESCROW_CONTRACT_ID: z.string().min(1),
  USDC_CONTRACT_ID: z.string().min(1),

  // Access control
  ADMIN_STELLAR_PUBKEYS: z.string().default(''),

  // Pinata / IPFS
  PINATA_API_KEY: z.string().optional(),
  PINATA_SECRET: z.string().optional(),
  PINATA_JWT: z.string().optional(),
  IPFS_GATEWAY_URL: z.string().default('https://gateway.pinata.cloud/ipfs'),
  IPFS_GATEWAY_URLS: z.string().optional(),
  IPFS_GATEWAY_ALLOWLIST: z.string().default(''),
  IPFS_UPLOAD_TIMEOUT_MS: z.coerce.number().default(10000),
  IPFS_STREAM_TIMEOUT_MS: z.coerce.number().default(5000),
  IPFS_PINATA_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().default(3),
  IPFS_PINATA_CIRCUIT_COOLDOWN_MS: z.coerce.number().default(30000),
  IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().default(3),
  IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS: z.coerce.number().default(30000),

  // Evidence / manifest retention
  EVIDENCE_MAX_BYTES: z.coerce.number().default(52428800),
  EVIDENCE_METADATA_RETENTION_DAYS: z.coerce.number().default(90),
  EVIDENCE_SCAN_REQUIRED: z
    .string()
    .default('false')
    .transform((value: string) => value.toLowerCase() === 'true'),
  MANIFEST_PII_RETENTION_DAYS: z.coerce.number().default(30),

  // Soroban event listener
  EVENT_POLL_INTERVAL_MS: z.coerce.number().default(10000),
  BACKOFF_INITIAL_MS: z.coerce.number().default(1000),
  BACKOFF_MAX_MS: z.coerce.number().default(30000),
  PROCESSED_LEDGERS_CACHE_SIZE: z.coerce.number().default(10000),
  EVENT_OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(5),

  // Distributed tracing
  JAEGER_ENDPOINT: z.string().optional(),
  ZIPKIN_ENDPOINT: z.string().optional(),
  PROMETHEUS_PORT: z.coerce.number().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_EXPORTER_JAEGER_AGENT_HOST: z.string().optional(),
  OTEL_EXPORTER_JAEGER_AGENT_PORT: z.coerce.number().optional(),

  // Audit signing
  AUDIT_SIGNING_KEY_ID: z.string().min(1).optional(),
  AUDIT_SIGNING_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  AUDIT_SIGNING_PUBLIC_KEY_PEM: z.string().min(1).optional(),

  // Webhooks
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  // Ops alert webhook configuration
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_SECRET: z.string().optional(),
  ALERT_COOLDOWN_MS: z.coerce.number().default(300_000),
  // Rate limiting configuration
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value: 'true' | 'false') => value === 'true'),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_REFRESH_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_REFRESH_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_USER_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  RATE_LIMIT_USER_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_DISPUTE_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  RATE_LIMIT_DISPUTE_MAX: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

function buildProcessEnv(): Record<string, string | undefined> {
  const processEnv = normalizeEnvInput({ ...process.env });

  if (processEnv.NODE_ENV === 'test') {
    processEnv.JWT_SECRET ||= 'test-jwt-secret-value-with-minimum-length-32';
    processEnv.DATABASE_URL ||= 'postgresql://localhost:5432/test';
    processEnv.AMANA_ESCROW_CONTRACT_ID ||= 'test-escrow-contract';
    processEnv.USDC_CONTRACT_ID ||= 'test-usdc-contract';
    processEnv.PINATA_API_KEY ||= 'test-pinata-api-key';
    processEnv.PINATA_SECRET ||= 'test-pinata-secret';
  }

  return processEnv;
}

export function parseEnvConfig(input: Record<string, string | undefined>) {
  return envSchema.safeParse(normalizeEnvInput(input));
}

export const env = envSchema.parse(buildProcessEnv());

/** Prefer runtime process.env overrides so tests can mutate env without reload. */
export function runtimeEnvValue<K extends keyof Env>(key: K): Env[K] {
  const runtime = process.env[key as string];
  if (runtime !== undefined) {
    const parsed = envSchema.shape[key].safeParse(runtime);
    if (parsed.success) {
      return parsed.data as Env[K];
    }
  }
  return env[key];
}
