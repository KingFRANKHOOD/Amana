import { Verifier } from '@pact-foundation/pact';
import path from 'path';
import express from 'express';
import jwt from 'jsonwebtoken';

import { createTradeRouter } from '../routes/trade.routes';
import { errorHandler } from '../middleware/errorHandler';
import { AuthService } from '../services/auth.service';
import { ContractService } from '../services/contract.service';
import { TradeService } from '../services/trade.service';

jest.mock('../services/contract.service');
jest.mock('../services/trade.service');
jest.mock('../services/auth.service', () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const JWT_SECRET = 'pact-provider-verify-secret-key-at-least-32-chars';

function createTestApp(): express.Application {
  const app = express();
  app.use(express.json());

  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_ISSUER = 'amana';
  process.env.JWT_AUDIENCE = 'amana-api';

  const tradeRouter = createTradeRouter();
  app.use('/trades', tradeRouter);
  app.use(errorHandler);

  return app;
}

describe('Pact Provider Verification - Trades API', () => {
  let app: express.Application;
  let server: ReturnType<express.Application['listen']>;

  beforeAll(async () => {
    app = createTestApp();

    const buyerAddress = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
    const sellerAddress = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';

    const now = Math.floor(Date.now() / 1000);
    const buyerToken = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: 'pact-verify-buyer-jti',
        iss: 'amana',
        aud: 'amana-api',
        nbf: now - 1,
        iat: now,
        exp: now + 3600,
      },
      JWT_SECRET,
      { algorithm: 'HS256' },
    );

    (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockResolvedValue({
      tradeId: '4294967297',
      unsignedXdr: 'AAAAAXNvbWUtY3JlYXRlLXRyYWRlLXhkcg==',
    });

    (TradeService.prototype.createPendingTrade as jest.Mock).mockResolvedValue({
      tradeId: '4294967297',
    });

    (TradeService.prototype.getTradeById as jest.Mock).mockImplementation(
      (tradeId: string, caller: string) => {
        if (caller === buyerAddress) {
          return {
            tradeId,
            buyerAddress,
            sellerAddress,
            amountCngn: '100.00',
            buyerLossBps: 5000,
            sellerLossBps: 5000,
            status: 'CREATED',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        if (caller === sellerAddress) {
          return {
            tradeId,
            buyerAddress,
            sellerAddress,
            amountCngn: '100.00',
            buyerLossBps: 5000,
            sellerLossBps: 5000,
            status: 'CREATED',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      },
    );

    (ContractService.prototype.buildDepositTx as jest.Mock).mockResolvedValue({
      unsignedXdr: 'AAAAAXNvbWUtZGVwb3NpdC10eC14ZHI=',
    });

    (TradeService.prototype.listUserTrades as jest.Mock).mockResolvedValue({
      items: [
        {
          tradeId: '4294967297',
          buyerAddress,
          sellerAddress,
          amountCngn: '100.00',
          buyerLossBps: 5000,
          sellerLossBps: 5000,
          status: 'CREATED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    (TradeService.prototype.getUserStats as jest.Mock).mockResolvedValue({
      totalTrades: 10,
      totalVolume: 250000,
      openTrades: 3,
    });

    (TradeService.prototype.initiateDispute as jest.Mock).mockResolvedValue({
      unsignedXdr: 'AAAAAXNvbWUtZGlzcHV0ZS14ZHI=',
    });

    jest.spyOn(AuthService, 'isTokenRevoked').mockResolvedValue(false);

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          process.env.PACT_PROVIDER_PORT = String(addr.port);
        }
        resolve();
      });
    });
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
    jest.restoreAllMocks();
  });

  it('verifies the provider against the consumer pact', async () => {
    const pactDir = path.resolve(__dirname, '../../../frontend/tests/pact/pacts');
    const port = process.env.PACT_PROVIDER_PORT || '3001';

    const output = await new Verifier({
      provider: 'AmanaBackend',
      providerBaseUrl: `http://localhost:${port}`,
      pactUrls: [
        path.resolve(pactDir, 'AmanaFrontend-AmanaBackend.json'),
      ],
      stateHandlers: {
        'a buyer is authenticated': async () => Promise.resolve(),
        'a trade exists in CREATED status': async () => Promise.resolve(),
        'a trade exists in FUNDED status': async () => Promise.resolve(),
        'a trade exists in DELIVERED status': async () => Promise.resolve(),
        'a trade exists with id 4294967297': async () => Promise.resolve(),
        'the user has trades': async () => Promise.resolve(),
        'the user has trade statistics': async () => Promise.resolve(),
      },
    }).verifyProvider();

    console.log('Pact Verification Complete:', output);
    expect(output).toBeDefined();
  });
});
