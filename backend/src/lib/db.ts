import { PrismaClient } from '@prisma/client';

// Ensure a single instance of Prisma Client is used across the application
declare global {
  var prisma: PrismaClient | undefined;
}

const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  client.$use(async (params, next) => {
    const model = String(params.model ?? "");
    const data = params.args?.data as Record<string, unknown> | undefined;

    if (!data) {
      return next(params);
    }

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

    return next(params);
  });

  return client;
};

export const prisma = global.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;
