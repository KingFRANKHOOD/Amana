import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { tradesApi } from '@/lib/api/trades';

const { like, eachLike, term, datetime } = MatchersV3;

describe('Trades API Pact Consumer Tests', () => {
  const provider = new PactV3({
    consumer: 'AmanaFrontend',
    provider: 'AmanaBackend',
    dir: './tests/pact/pacts',
  });

  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token';

  describe('POST /trades - Create Trade', () => {
    it('creates a trade and returns tradeId and unsignedXdr', async () => {
      provider
        .given('a buyer is authenticated')
        .uponReceiving('a request to create a trade')
        .withRequest({
          method: 'POST',
          path: '/trades',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {
            sellerAddress: 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3',
            amountCngn: '100.00',
            buyerLossBps: 5000,
            sellerLossBps: 5000,
          },
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: {
            tradeId: term({
              matcher: '\\d+',
              generate: '4294967297',
            }),
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtY3JlYXRlLXRyYWRlLXhkcg==',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.create(mockToken, {
          sellerAddress: 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3',
          amountCngn: '100.00',
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });

        expect(result).toHaveProperty('tradeId');
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('POST /trades/:id/deposit - Build Deposit Tx', () => {
    it('returns an unsigned deposit XDR for a valid trade', async () => {
      provider
        .given('a trade exists in CREATED status')
        .uponReceiving('a request to build a deposit transaction')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/deposit',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {},
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtZGVwb3NpdC10eC14ZHI=',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.deposit(mockToken, '4294967297');
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('POST /trades/:id/confirm - Confirm Delivery', () => {
    it('returns an unsigned confirm delivery XDR', async () => {
      provider
        .given('a trade exists in FUNDED status')
        .uponReceiving('a request to confirm delivery')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/confirm',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {},
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtY29uZmlybS14ZHI=',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.confirmDelivery(mockToken, '4294967297');
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('POST /trades/:id/release - Release Funds', () => {
    it('returns an unsigned release funds XDR', async () => {
      provider
        .given('a trade exists in DELIVERED status')
        .uponReceiving('a request to release funds')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/release',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {},
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtcmVsZWFzZS14ZHI=',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.releaseFunds(mockToken, '4294967297');
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('POST /trades/:id/dispute - Initiate Dispute', () => {
    it('returns an unsigned dispute XDR', async () => {
      provider
        .given('a trade exists in FUNDED status')
        .uponReceiving('a request to initiate a dispute')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/dispute',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {
            reason: 'Goods not delivered as agreed',
            category: 'delivery_issue',
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtZGlzcHV0ZS14ZHI=',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.initiateDispute(
          mockToken,
          '4294967297',
          'Goods not delivered as agreed',
          'delivery_issue',
        );
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('GET /trades/:id - Get Trade', () => {
    it('returns trade details', async () => {
      provider
        .given('a trade exists with id 4294967297')
        .uponReceiving('a request to get a trade by id')
        .withRequest({
          method: 'GET',
          path: '/trades/4294967297',
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            tradeId: '4294967297',
            buyerAddress: like('GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU'),
            sellerAddress: like('GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3'),
            amountCngn: '100.00',
            buyerLossBps: 5000,
            sellerLossBps: 5000,
            status: 'CREATED',
            createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-01T00:00:00.000Z'),
            updatedAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-01T00:00:00.000Z'),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.get(mockToken, '4294967297');
        expect(result.tradeId).toBe('4294967297');
        expect(result).toHaveProperty('buyerAddress');
        expect(result).toHaveProperty('sellerAddress');
        expect(result).toHaveProperty('status');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('GET /trades - List Trades', () => {
    it('returns a paginated list of trades', async () => {
      provider
        .given('the user has trades')
        .uponReceiving('a request to list trades')
        .withRequest({
          method: 'GET',
          path: '/trades',
          query: { page: '1', limit: '10' },
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            items: eachLike({
              tradeId: '4294967297',
              buyerAddress: like('GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU'),
              sellerAddress: like('GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3'),
              amountCngn: '100.00',
              buyerLossBps: 5000,
              sellerLossBps: 5000,
              status: 'CREATED',
              createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-01T00:00:00.000Z'),
              updatedAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-01T00:00:00.000Z'),
            }),
            pagination: {
              page: 1,
              limit: 10,
              total: 1,
              totalPages: 1,
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.list(mockToken, { page: 1, limit: 10 });
        expect(result.items).toBeDefined();
        expect(result.pagination).toBeDefined();

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('GET /trades/stats - Get Trade Stats', () => {
    it('returns trade statistics', async () => {
      provider
        .given('the user has trade statistics')
        .uponReceiving('a request to get trade stats')
        .withRequest({
          method: 'GET',
          path: '/trades/stats',
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            totalTrades: 10,
            totalVolume: 250000,
            openTrades: 3,
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.getStats(mockToken);
        expect(result).toHaveProperty('totalTrades');
        expect(result).toHaveProperty('totalVolume');
        expect(result).toHaveProperty('openTrades');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });
});
