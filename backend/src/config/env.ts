import { z } from 'zod';

const processEnv = { ...process.env };
if (processEnv.NODE_ENV === 'test') {
  processEnv.JWT_SECRET ||= 'test-jwt-secret-value-with-minimum-length-32';
  processEnv.DATABASE_URL ||= 'postgresql://localhost:5432/test';
  processEnv.AMANA_ESCROW_CONTRACT_ID ||= 'test-escrow-contract';
  processEnv.USDC_CONTRACT_ID ||= 'test-usdc-contract';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
  STELLAR_RPC_URL: z.string().optional(),
  AMANA_ESCROW_CONTRACT_ID: z.string().min(1),
  USDC_CONTRACT_ID: z.string().min(1),
  // Distributed tracing configuration
  JAEGER_ENDPOINT: z.string().optional(),
  ZIPKIN_ENDPOINT: z.string().optional(),
  PROMETHEUS_PORT: z.coerce.number().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_EXPORTER_JAEGER_AGENT_HOST: z.string().optional(),
  OTEL_EXPORTER_JAEGER_AGENT_PORT: z.coerce.number().optional(),
  // Audit signing configuration
  AUDIT_SIGNING_KEY_ID: z.string().min(1).optional(),
  AUDIT_SIGNING_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  AUDIT_SIGNING_PUBLIC_KEY_PEM: z.string().min(1).optional(),
});

export const env = envSchema.parse(processEnv);

