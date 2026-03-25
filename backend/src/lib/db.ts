import { PrismaClient } from '@prisma/client';

// Ensure a single instance of Prisma Client is used across the application
declare global {
  var prisma: PrismaClient | undefined;
}

const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  // Middleware to ensure all walletAddress values are stored as lowercase
  client.$use(async (params, next) => {
    // Convert walletAddress to lowercase for User model operations
    if (params.model === 'User' && params.args.data) {
      if (typeof params.args.data.walletAddress === 'string') {
        params.args.data.walletAddress = params.args.data.walletAddress.toLowerCase();
      }
    }

    // Convert walletAddress to lowercase for Trade model operations
    if (params.model === 'Trade' && params.args.data) {
      if (typeof params.args.data.buyerAddress === 'string') {
        params.args.data.buyerAddress = params.args.data.buyerAddress.toLowerCase();
      }
      if (typeof params.args.data.sellerAddress === 'string') {
        params.args.data.sellerAddress = params.args.data.sellerAddress.toLowerCase();
      }
    }

    // Convert walletAddress to lowercase for Dispute model operations
    if (params.model === 'Dispute' && params.args.data) {
      if (typeof params.args.data.initiator === 'string') {
        params.args.data.initiator = params.args.data.initiator.toLowerCase();
      }
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
