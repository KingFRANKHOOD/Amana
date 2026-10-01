/**
 * @jest-environment node
 *
 * Pact consumer tests run against a mocked HTTP server and don't need a DOM.
 * The jsdom test environment used by the rest of the frontend suite does not
 * expose `fetch`/`Request`/`Response`/`Headers`/`ReadableStream`, which the
 * API client (and undici underneath Pact) require. Running this suite under
 * the Node environment gives us those globals natively.
 */
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { tradesApi } from '@/lib/api/trades';

const { like, eachLike, regex, datetime } = MatchersV3;

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
            tradeId: regex('\\d+', '4294967297'),
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtY3JlYXRlLXRyYWRlLXhkcg=='),
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
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtZGVwb3NpdC10eC14ZHI='),
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
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtY29uZmlybS14ZHI='),
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
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtcmVsZWFzZS14ZHI='),
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
            unsignedXdr: regex('[A-Za-z0-9+/=]+', 'AAAAAXNvbWUtZGlzcHV0ZS14ZHI='),
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
            tradeId: regex('\\d+', '4294967297'),
            sellerAddress: like('GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3'),
            buyerAddress: like('GB5U44ZL7I7E6F8ARZ6X4K3M8G9L0C1O2N3Q4R5S6T7U8V9W0X1Y2Z3'),
            amountCngn: like('100.00'),
            status: like('CREATED'),
            createdAt: datetime('2024-01-01T00:00:00.000Z'),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.get(mockToken, '4294967297');
        expect(result).toHaveProperty('tradeId');
        expect(result).toHaveProperty('status');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });
});
