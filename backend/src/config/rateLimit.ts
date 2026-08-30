import { runtimeEnvValue } from './env';

export interface RateLimitPreset {
  windowMs: number;
  max: number;
  message: string;
}

export const RATE_LIMIT_CONFIG = {
  auth: {
    windowMs: runtimeEnvValue('RATE_LIMIT_AUTH_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_AUTH_MAX'),
    message: 'Too many challenges/verify attempts, try again later.',
  },
  authRefresh: {
    windowMs: runtimeEnvValue('RATE_LIMIT_AUTH_REFRESH_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_AUTH_REFRESH_MAX'),
    message: 'Too many token refresh attempts, try again later.',
  },
  user: {
    windowMs: runtimeEnvValue('RATE_LIMIT_USER_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_USER_MAX'),
    message: 'Too many user profile requests, try again later.',
  },
  dispute: {
    windowMs: runtimeEnvValue('RATE_LIMIT_DISPUTE_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_DISPUTE_MAX'),
    message: 'Too many dispute initiation attempts, try again later.',
  },
  tradeCreation: {
    windowMs: runtimeEnvValue('RATE_LIMIT_TRADE_CREATION_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_TRADE_CREATION_MAX'),
    message: 'Too many trade creation attempts, try again later.',
  },
  evidenceUpload: {
    windowMs: runtimeEnvValue('RATE_LIMIT_EVIDENCE_UPLOAD_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_EVIDENCE_UPLOAD_MAX'),
    message: 'Too many evidence upload attempts, try again later.',
  },
  eventQuery: {
    windowMs: runtimeEnvValue('RATE_LIMIT_EVENT_QUERY_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_EVENT_QUERY_MAX'),
    message: 'Too many event indexer requests, try again later.',
  },
  eventBackfill: {
    windowMs: runtimeEnvValue('RATE_LIMIT_EVENT_BACKFILL_WINDOW_MS'),
    max: runtimeEnvValue('RATE_LIMIT_EVENT_BACKFILL_MAX'),
    message: 'Too many backfill requests, try again later.',
  },
} as const satisfies Record<string, RateLimitPreset>;
