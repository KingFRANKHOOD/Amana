/**
 * Tests for the real wallet-address lowercasing middleware registered by
 * `src/lib/db.ts`, including a check that `db.ts` actually registers it.
 */
import type { Prisma } from '@prisma/client';
import { lowercaseWalletAddressesMiddleware } from '../lib/walletAddressMiddleware';

const MIXED = '0xAbCdEf0123456789ABCDEF0123456789abcdef01';
const LOWER = MIXED.toLowerCase();

function params(model: string | undefined, data?: Record<string, unknown>): Prisma.MiddlewareParams {
  return {
    model,
    action: 'create',
    args: data === undefined ? {} : { data },
    dataPath: [],
    runInTransaction: false,
  } as unknown as Prisma.MiddlewareParams;
}

async function run(p: Prisma.MiddlewareParams) {
  const next = jest.fn(async (forwarded: Prisma.MiddlewareParams) => ({ forwarded }));
  const result = await lowercaseWalletAddressesMiddleware(p, next);
  return { next, result };
}

describe('lowercaseWalletAddressesMiddleware', () => {
  it.each([
    ['User', 'walletAddress'],
    ['Trade', 'buyerAddress'],
    ['Trade', 'sellerAddress'],
    ['Dispute', 'initiator'],
  ])('lowercases %s.%s', async (model, field) => {
    const p = params(model, { [field]: MIXED, untouched: 'KeepCase' });
    const { next } = await run(p);

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0][0].args.data as Record<string, unknown>;
    expect(forwarded[field]).toBe(LOWER);
    expect(forwarded.untouched).toBe('KeepCase');
  });

  it('lowercases both trade parties in one write', async () => {
    const p = params('Trade', { buyerAddress: MIXED, sellerAddress: MIXED.toUpperCase() });
    await run(p);
    expect(p.args.data).toEqual({ buyerAddress: LOWER, sellerAddress: LOWER });
  });

  it('rewrites the data Prisma will send, in place', async () => {
    const data = { walletAddress: MIXED };
    await run(params('User', data));
    expect(data.walletAddress).toBe(LOWER);
  });

  it('does not touch address-like fields on other models', async () => {
    const p = params('Vault', { ownerAddress: MIXED, walletAddress: MIXED });
    await run(p);
    expect(p.args.data).toEqual({ ownerAddress: MIXED, walletAddress: MIXED });
  });

  it('only lowercases the fields that belong to each model', async () => {
    const p = params('User', { buyerAddress: MIXED, initiator: MIXED });
    await run(p);
    expect(p.args.data).toEqual({ buyerAddress: MIXED, initiator: MIXED });
  });

  it('leaves non-string values alone', async () => {
    const nested = { set: MIXED };
    const p = params('User', { walletAddress: nested });
    await run(p);
    expect((p.args.data as { walletAddress: unknown }).walletAddress).toBe(nested);
  });

  it('passes through operations without data and returns next()', async () => {
    const p = params('User');
    const { next, result } = await run(p);
    expect(next).toHaveBeenCalledWith(p);
    expect(result).toEqual({ forwarded: p });
  });

  it('handles raw queries with no model', async () => {
    const { next } = await run(params(undefined, { walletAddress: MIXED }));
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('db.ts Prisma client wiring', () => {
  it('registers lowercaseWalletAddressesMiddleware on the Prisma client', () => {
    const use = jest.fn();
    let registered: unknown[] = [];

    jest.isolateModules(() => {
      jest.doMock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({ $use: use })),
      }));
      jest.doMock('../config/env', () => ({ env: { NODE_ENV: 'test' } }));

      const globalWithPrisma = global as typeof globalThis & { prisma?: unknown };
      const previous = globalWithPrisma.prisma;
      delete globalWithPrisma.prisma;
      try {
        const { lowercaseWalletAddressesMiddleware: fromModule } =
          require('../lib/walletAddressMiddleware') as typeof import('../lib/walletAddressMiddleware');
        require('../lib/db');
        registered = use.mock.calls.map(([fn]) => fn);
        expect(registered).toContain(fromModule);
      } finally {
        globalWithPrisma.prisma = previous;
      }
    });

    expect(use).toHaveBeenCalled();
  });
});
