import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useAuthStore } from '../../stores/authStore';
import { useTradeStore } from '../../stores/tradeStore';
import { tradeApi } from '../../api/trade';
import { authorizeSensitiveAction } from '../../services/biometric.service';
import { signStellarTransaction } from '../../services/stellar-wallet-connect.service';
import type { Trade } from '../../types/trade';

jest.mock('../../api/trade', () => ({
  tradeApi: {
    listTrades: jest.fn(),
    getTrade: jest.fn(),
    createTrade: jest.fn(),
    confirmDelivery: jest.fn(),
    releaseFunds: jest.fn(),
    deposit: jest.fn(),
    submitSignedTransaction: jest.fn(),
    initiateDispute: jest.fn(),
  },
}));

jest.mock('../../services/biometric.service', () => ({
  authorizeSensitiveAction: jest.fn(),
}));

jest.mock('../../services/stellar-wallet-connect.service', () => ({
  signStellarTransaction: jest.fn(),
}));

const buyerAddress = 'GBUYER123456789012345678901234567890123456789012345678';
const mockTrade: Trade = {
  id: 1,
  tradeId: 'trade-123',
  buyerAddress,
  sellerAddress: 'GSELLER123456789012345678901234567890123456789012345678',
  amountUsdc: '100',
  status: 'PENDING_SIGNATURE',
};
const mockTradeApi = jest.mocked(tradeApi);
const mockAuthorize = jest.mocked(authorizeSensitiveAction);
const mockSignTransaction = jest.mocked(signStellarTransaction);

describe('tradeStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ walletAddress: buyerAddress });
    useTradeStore.setState({
      trades: [],
      total: 0,
      currentTrade: null,
      lastTransactionSubmission: null,
      isLoading: false,
      error: null,
    });
    mockAuthorize.mockResolvedValue(true);
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockTradeApi.submitSignedTransaction.mockResolvedValue({
      hash: 'transaction-hash',
      status: 'PENDING',
    });
  });

  it('fetchTrades populates trades on success', async () => {
    mockTradeApi.listTrades.mockResolvedValue({
      trades: [mockTrade],
      total: 1,
      page: 1,
      limit: 10,
    });

    await useTradeStore.getState().fetchTrades();

    expect(useTradeStore.getState().trades).toEqual([mockTrade]);
    expect(useTradeStore.getState().isLoading).toBe(false);
  });

  it('fetchTrades sets error on failure', async () => {
    mockTradeApi.listTrades.mockRejectedValue(new Error('network down'));

    await useTradeStore.getState().fetchTrades();

    expect(useTradeStore.getState().error).toBe('network down');
    expect(useTradeStore.getState().trades).toEqual([]);
  });

  it('fetchTrade populates currentTrade on success', async () => {
    mockTradeApi.getTrade.mockResolvedValue(mockTrade);

    await useTradeStore.getState().fetchTrade('trade-123');

    expect(useTradeStore.getState().currentTrade).toEqual(mockTrade);
  });

  it('fetchTrade sets error on failure', async () => {
    mockTradeApi.getTrade.mockRejectedValue(new Error('not found'));

    await useTradeStore.getState().fetchTrade('trade-123');

    expect(useTradeStore.getState().error).toBe('not found');
  });

  it('createTrade requires biometric authorization', async () => {
    mockAuthorize.mockResolvedValue(false);

    const result = await useTradeStore.getState().createTrade({
      sellerAddress: mockTrade.sellerAddress,
      amountUsdc: '100',
    });

    expect(result).toBeNull();
    expect(useTradeStore.getState().error).toBe('Authentication cancelled');
  });

  it('createTrade returns created trade id', async () => {
    mockTradeApi.createTrade.mockResolvedValue({
      tradeId: 'trade-999',
      unsignedXdr: 'xdr',
    });

    const result = await useTradeStore.getState().createTrade({
      sellerAddress: mockTrade.sellerAddress,
      amountUsdc: '100',
    });

    expect(result).toEqual({ tradeId: 'trade-999', unsignedXdr: 'xdr' });
  });

  it('confirmDelivery updates currentTrade', async () => {
    mockTradeApi.confirmDelivery.mockResolvedValue({ ...mockTrade, status: 'DELIVERED' });

    await useTradeStore.getState().confirmDelivery('trade-123');

    expect(useTradeStore.getState().currentTrade?.status).toBe('DELIVERED');
  });

  it('releaseFunds requires biometric authorization', async () => {
    mockAuthorize.mockResolvedValue(false);

    await useTradeStore.getState().releaseFunds('trade-123', jest.fn());

    expect(mockTradeApi.releaseFunds).not.toHaveBeenCalled();
    expect(useTradeStore.getState().error).toBe('Authentication cancelled');
  });

  it('releaseFunds signs, submits, and refreshes the current trade', async () => {
    useTradeStore.setState({ currentTrade: mockTrade });
    mockTradeApi.releaseFunds.mockResolvedValue({ unsignedXdr: 'release-unsigned-xdr' });
    mockTradeApi.getTrade.mockResolvedValue({ ...mockTrade, status: 'COMPLETED' });

    await useTradeStore.getState().releaseFunds('trade-123', jest.fn());

    expect(mockTradeApi.releaseFunds).toHaveBeenCalledWith('trade-123');
    expect(mockSignTransaction).toHaveBeenCalledWith(
      'release-unsigned-xdr',
      buyerAddress,
      expect.any(Function),
    );
    expect(mockTradeApi.submitSignedTransaction).toHaveBeenCalledWith(
      'trade-123',
      'signed-xdr',
    );
    expect(useTradeStore.getState().currentTrade?.status).toBe('COMPLETED');
  });

  it('deposit signs, submits, and refreshes the current trade', async () => {
    useTradeStore.setState({ currentTrade: mockTrade });
    mockTradeApi.deposit.mockResolvedValue({ unsignedXdr: 'deposit-unsigned-xdr' });
    mockTradeApi.getTrade.mockResolvedValue({ ...mockTrade, status: 'FUNDED' });

    await useTradeStore.getState().deposit('trade-123', jest.fn());

    expect(mockTradeApi.deposit).toHaveBeenCalledWith('trade-123');
    expect(mockSignTransaction).toHaveBeenCalledWith(
      'deposit-unsigned-xdr',
      buyerAddress,
      expect.any(Function),
    );
    expect(mockTradeApi.submitSignedTransaction).toHaveBeenCalledWith(
      'trade-123',
      'signed-xdr',
    );
    expect(useTradeStore.getState().currentTrade?.status).toBe('FUNDED');
    expect(useTradeStore.getState().lastTransactionSubmission).toEqual({
      hash: 'transaction-hash',
      status: 'PENDING',
    });
  });

  it('does not submit when the wallet cancels signing', async () => {
    mockTradeApi.deposit.mockResolvedValue({ unsignedXdr: 'deposit-unsigned-xdr' });
    mockSignTransaction.mockRejectedValue(new Error('User rejected the transaction'));

    await useTradeStore.getState().deposit('trade-123', jest.fn());

    expect(mockTradeApi.submitSignedTransaction).not.toHaveBeenCalled();
    expect(useTradeStore.getState().error).toBe('User rejected the transaction');
  });

  it('initiateDispute updates currentTrade', async () => {
    mockTradeApi.initiateDispute.mockResolvedValue({ ...mockTrade, status: 'DISPUTED' });

    await useTradeStore.getState().initiateDispute('trade-123', 'reason');

    expect(useTradeStore.getState().currentTrade?.status).toBe('DISPUTED');
  });

  it('clearError resets the error state', () => {
    useTradeStore.setState({ error: 'some error' });

    useTradeStore.getState().clearError();

    expect(useTradeStore.getState().error).toBeNull();
  });

  it('resetStore clears all trade state back to initial values', () => {
    useTradeStore.setState({
      trades: [mockTrade],
      total: 1,
      currentTrade: mockTrade,
      lastTransactionSubmission: { hash: 'transaction-hash', status: 'PENDING' },
      isLoading: true,
      error: 'some error',
    });

    useTradeStore.getState().resetStore();

    const state = useTradeStore.getState();
    expect(state.trades).toEqual([]);
    expect(state.total).toBe(0);
    expect(state.currentTrade).toBeNull();
    expect(state.lastTransactionSubmission).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });
});
