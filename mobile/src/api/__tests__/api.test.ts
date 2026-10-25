import { tradeApi } from '../trade';
import { authApi } from '../auth';
import apiClient from '../client';

jest.mock('../client', () => {
  const mockClient = {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() } },
  };
  return { __esModule: true, default: mockClient };
});

describe('tradeApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listTrades calls GET /trades with params', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { trades: [], total: 0, page: 1, limit: 10 } });
    await tradeApi.listTrades({ status: 'PENDING', page: 2, limit: 20 });
    expect(apiClient.get).toHaveBeenCalledWith('/trades', { params: { status: 'PENDING', page: 2, limit: 20 } });
  });

  it('getTrade calls GET /trades/:id', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { tradeId: 't1' } });
    await tradeApi.getTrade('t1');
    expect(apiClient.get).toHaveBeenCalledWith('/trades/t1');
  });

  it('createTrade calls POST /trades', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { tradeId: 't1', unsignedXdr: 'x' } });
    await tradeApi.createTrade({ sellerAddress: 'G_SELLER', amountUsdc: '100' });
    expect(apiClient.post).toHaveBeenCalledWith('/trades', { sellerAddress: 'G_SELLER', amountUsdc: '100' });
  });

  it('confirmDelivery calls POST /trades/:id/confirm', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { tradeId: 't1' } });
    await tradeApi.confirmDelivery('t1');
    expect(apiClient.post).toHaveBeenCalledWith('/trades/t1/confirm');
  });

  it('releaseFunds calls POST /trades/:id/release', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { unsignedXdr: 'x' } });
    await tradeApi.releaseFunds('t1');
    expect(apiClient.post).toHaveBeenCalledWith('/trades/t1/release');
  });

  it('deposit calls POST /trades/:id/deposit', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { unsignedXdr: 'x' } });
    await tradeApi.deposit('t1');
    expect(apiClient.post).toHaveBeenCalledWith('/trades/t1/deposit');
  });

  it('initiateDispute calls POST /trades/:id/dispute with reason', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { tradeId: 't1' } });
    await tradeApi.initiateDispute('t1', 'reason');
    expect(apiClient.post).toHaveBeenCalledWith('/trades/t1/dispute', { reason: 'reason' });
  });
});

describe('authApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generateChallenge calls POST /auth/challenge', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { challenge: 'c' } });
    const result = await authApi.generateChallenge('G_ADDR');
    expect(apiClient.post).toHaveBeenCalledWith('/auth/challenge', { walletAddress: 'G_ADDR' });
    expect(result).toEqual({ challenge: 'c' });
  });

  it('verifyChallenge calls POST /auth/verify', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { token: 't' } });
    const result = await authApi.verifyChallenge('G_ADDR', 'signed');
    expect(apiClient.post).toHaveBeenCalledWith('/auth/verify', { walletAddress: 'G_ADDR', signedChallenge: 'signed' });
    expect(result).toEqual({ token: 't' });
  });

  it('refreshToken calls POST /auth/refresh', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { token: 't' } });
    await authApi.refreshToken();
    expect(apiClient.post).toHaveBeenCalledWith('/auth/refresh');
  });
});
