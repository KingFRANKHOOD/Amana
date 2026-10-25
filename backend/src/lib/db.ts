import { PrismaClient, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { lowercaseWalletAddressesMiddleware } from './walletAddressMiddleware';

// Ensure a single instance of Prisma Client is used across the application
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const SLOW_QUERY_THRESHOLD_MS = 1000;

const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  client.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<unknown>) => {
    const model = String(params.model ?? "");
    const operation = params.action ?? "unknown";
    const start = performance.now();

    try {
      const result = await next(params);
      const durationMs = performance.now() - start;

      // Log slow queries for pool exhaustion diagnosis
      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        console.warn(
          `[db] Slow query: ${model}.${operation} took ${durationMs.toFixed(1)}ms`,
        );
      }

      return result;
    } catch (error) {
      const durationMs = performance.now() - start;

      // Log connection acquisition failures (pool exhaustion indicator)
      const message = error instanceof Error ? error.message : String(error);
      if (/connection|pool|timeout/i.test(message)) {
        console.error(
          `[db] Connection pool error: ${model}.${operation} failed after ${durationMs.toFixed(1)}ms — ${message}`,
        );
      }

      throw error;
    }
  });

  // Lowercase wallet addresses on write operations
  client.$use(lowercaseWalletAddressesMiddleware);

  return client;
};

export const prisma = global.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;
