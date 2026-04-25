import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('86400'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
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
});

export const env = envSchema.parse(process.env);

