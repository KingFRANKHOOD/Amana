import type { Prisma } from '@prisma/client';

/**
 * Prisma `$use` middleware that lowercases wallet addresses on write
 * operations, so the same wallet can never be stored under two casings.
 *
 * Kept in its own module (no Prisma client, no env access) so tests can
 * exercise the exact function `db.ts` registers.
 */
export async function lowercaseWalletAddressesMiddleware(
  params: Prisma.MiddlewareParams,
  next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
): Promise<unknown> {
  const model = String(params.model ?? "");

  const data = params.args?.data as Record<string, unknown> | undefined;

  if (data) {
    if (model === 'User' && typeof data.walletAddress === 'string') {
      data.walletAddress = data.walletAddress.toLowerCase();
    }

    if (model === 'Trade') {
      if (typeof data.buyerAddress === 'string') {
        data.buyerAddress = data.buyerAddress.toLowerCase();
      }
      if (typeof data.sellerAddress === 'string') {
        data.sellerAddress = data.sellerAddress.toLowerCase();
      }
    }

    if (model === 'Dispute' && typeof data.initiator === 'string') {
      data.initiator = data.initiator.toLowerCase();
    }
  }

  return next(params);
}
