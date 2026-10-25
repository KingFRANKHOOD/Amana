import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { tradeApi } from '../../src/api/trade';
import apiClient from '../../src/api/client';
import { useAuthStore } from '../../src/stores/authStore';

const { like, regex, datetime, eachLike } = MatchersV3;

describe('Mobile Trades API Pact Consumer Tests', () => {
  const provider = new PactV3({
    consumer: 'AmanaMobile',
    provider: 'AmanaBackend',
    dir: './tests/pact/pacts',
  });

  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token';
  const sellerAddress = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';

  function pointAt(mockServerUrl: string) {
    const original = apiClient.defaults.baseURL;
    apiClient.defaults.baseURL = mockServerUrl;
    return () => {
      apiClient.defaults.baseURL = original;
    };
  }

  beforeEach(() => {
    useAuthStore.setState({ token: mockToken, walletAddress: null, isLoading: false });
  });

  describe('POST /trades - Create Trade', () => {
    it('creates a trade and returns tradeId and unsignedXdr', async () => {
      provider
        .given('a buyer is authenticated')
        .uponReceiving('a mobile request to create a trade')
        .withRequest({
          method: 'POST',
          path: '/trades',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {
            sellerAddress,
            amountUsdc: '100.00',
            buyerLossBps: 5000,
            sellerLossBps: 5000,
          },
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: {
            tradeId: regex('\\d+', '4294967297'),
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtY3JlYXRlLXRyYWRlLXhkcg=='),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const restore = pointAt(mockServer.url);
        const result = await tradeApi.createTrade({
          sellerAddress,
          amountUsdc: '100.00',
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result).toHaveProperty('tradeId');
        expect(result).toHaveProperty('unsignedXdr');
        restore();
      });
    });
  });

  describe('GET /trades/:id - Get Trade', () => {
    it('returns trade details', async () => {
      provider
        .given('a trade exists with id 4294967297')
        .uponReceiving('a mobile request to get a trade by id')
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
            sellerAddress: like(sellerAddress),
            amountCngn: like('100.00'),
            buyerLossBps: 5000,
            sellerLossBps: 5000,
            status: like('CREATED'),
            createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-01T00:00:00.000Z'),
            updatedAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-01T00:00:00.000Z'),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const restore = pointAt(mockServer.url);
        const result = await tradeApi.getTrade('4294967297');
        expect(result.tradeId).toBe('4294967297');
        expect(result).toHaveProperty('buyerAddress');
        expect(result).toHaveProperty('sellerAddress');
        expect(result).toHaveProperty('status');
        restore();
      });
    });
  });

  describe('GET /trades - List Trades', () => {
    it('returns a paginated list of trades', async () => {
      provider
        .given('the user has trades')
        .uponReceiving('a mobile request to list trades')
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
              sellerAddress: like(sellerAddress),
              amountCngn: like('100.00'),
              buyerLossBps: 5000,
              sellerLossBps: 5000,
              status: like('CREATED'),
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
        const restore = pointAt(mockServer.url);
        const result = await tradeApi.listTrades({ page: 1, limit: 10 });
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('pagination');
        restore();
      });
    });
  });

  describe('POST /trades/:id/deposit - Build Deposit Tx', () => {
    it('returns an unsigned deposit XDR for a valid trade', async () => {
      provider
        .given('a trade exists in CREATED status')
        .uponReceiving('a mobile request to build a deposit transaction')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/deposit',
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtZGVwb3NpdC10eC14ZHI='),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const restore = pointAt(mockServer.url);
        const result = await tradeApi.deposit('4294967297');
        expect(result).toHaveProperty('unsignedXdr');
        restore();
      });
    });
  });

  describe('POST /trades/:id/confirm - Confirm Delivery', () => {
    it('returns an unsigned confirm delivery XDR', async () => {
      provider
        .given('a trade exists in FUNDED status')
        .uponReceiving('a mobile request to confirm delivery')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/confirm',
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtY29uZmlybS14ZHI='),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const restore = pointAt(mockServer.url);
        const result = await tradeApi.confirmDelivery('4294967297');
        expect(result).toHaveProperty('unsignedXdr');
        restore();
      });
    });
  });

  describe('POST /trades/:id/release - Release Funds', () => {
    it('returns an unsigned release funds XDR', async () => {
      provider
        .given('a trade exists in DELIVERED status')
        .uponReceiving('a mobile request to release funds')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/release',
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtcmVsZWFzZS14ZHI='),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const restore = pointAt(mockServer.url);
        const result = await tradeApi.releaseFunds('4294967297');
        expect(result).toHaveProperty('unsignedXdr');
        restore();
      });
    });
  });
});
