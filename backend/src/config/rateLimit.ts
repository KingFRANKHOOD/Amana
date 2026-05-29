import { env } from './env';

export interface RateLimitPreset {
  windowMs: number;
  max: number;
  message: string;
}

export const RATE_LIMIT_CONFIG = {
  auth: {
    windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
    max: env.RATE_LIMIT_AUTH_MAX,
    message: 'Too many challenges/verify attempts, try again later.',
  },
  authRefresh: {
    windowMs: env.RATE_LIMIT_AUTH_REFRESH_WINDOW_MS,
    max: env.RATE_LIMIT_AUTH_REFRESH_MAX,
    message: 'Too many token refresh attempts, try again later.',
  },
  user: {
    windowMs: env.RATE_LIMIT_USER_WINDOW_MS,
    max: env.RATE_LIMIT_USER_MAX,
    message: 'Too many user profile requests, try again later.',
  },
  dispute: {
    windowMs: env.RATE_LIMIT_DISPUTE_WINDOW_MS,
    max: env.RATE_LIMIT_DISPUTE_MAX,
    message: 'Too many dispute initiation attempts, try again later.',
  },
} as const satisfies Record<string, RateLimitPreset>;
