import { useTradeStore } from '../../stores/tradeStore';
import { tradeApi } from '../../api/trade';
import * as biometric from '../../services/biometric.service';

jest.mock('../../api/trade', () => ({
  tradeApi: {
    listTrades: jest.fn(),
    getTrade: jest.fn(),
    createTrade: jest.fn(),
    confirmDelivery: jest.fn(),
    releaseFunds: jest.fn(),
    deposit: jest.fn(),
    initiateDispute: jest.fn(),
  },
}));

jest.mock('../../services/biometric.service', () => ({
  authorizeSensitiveAction: jest.fn(),
}));
const mockTrade = {
  id: 1,
  tradeId: 'trade-123',
  buyerAddress: 'G_BUYER',
  sellerAddress: 'G_SELLER',
  amountUsdc: '100',
  status: 'PENDING',
};

describe('tradeStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTradeStore.setState({
      trades: [],
      total: 0,
      currentTrade: null,
      isLoading: false,
      error: null,
    });
    (biometric.authorizeSensitiveAction as jest.Mock).mockResolvedValue(true);
  });

  it('fetchTrades populates trades on success', async () => {
    (tradeApi.listTrades as jest.Mock).mockResolvedValue({ trades: [mockTrade], total: 1, page: 1, limit: 10 });
    await useTradeStore.getState().fetchTrades();
    expect(useTradeStore.getState().trades).toEqual([mockTrade]);
    expect(useTradeStore.getState().isLoading).toBe(false);
  });

  it('fetchTrades sets error on failure', async () => {
    (tradeApi.listTrades as jest.Mock).mockRejectedValue(new Error('network down'));
    await useTradeStore.getState().fetchTrades();
    expect(useTradeStore.getState().error).toBe('network down');
    expect(useTradeStore.getState().trades).toEqual([]);
  });

  it('fetchTrade populates currentTrade on success', async () => {
    (tradeApi.getTrade as jest.Mock).mockResolvedValue(mockTrade);
    await useTradeStore.getState().fetchTrade('trade-123');
    expect(useTradeStore.getState().currentTrade).toEqual(mockTrade);
  });

  it('fetchTrade sets error on failure', async () => {
    (tradeApi.getTrade as jest.Mock).mockRejectedValue(new Error('not found'));
    await useTradeStore.getState().fetchTrade('trade-123');
    expect(useTradeStore.getState().error).toBe('not found');
  });

  it('createTrade requires biometric authorization', async () => {
    (biometric.authorizeSensitiveAction as jest.Mock).mockResolvedValue(false);
    const result = await useTradeStore.getState().createTrade({ sellerAddress: 'G_SELLER', amountUsdc: '100' });
    expect(result).toBeNull();
    expect(useTradeStore.getState().error).toBe('Authentication cancelled');
  });

  it('createTrade returns created trade id', async () => {
    (tradeApi.createTrade as jest.Mock).mockResolvedValue({ tradeId: 'trade-999', unsignedXdr: 'xdr' });
    const result = await useTradeStore.getState().createTrade({ sellerAddress: 'G_SELLER', amountUsdc: '100' });
    expect(result).toEqual({ tradeId: 'trade-999', unsignedXdr: 'xdr' });
  });

  it('confirmDelivery updates currentTrade', async () => {
    useTradeStore.setState({ currentTrade: mockTrade as any });
    (tradeApi.confirmDelivery as jest.Mock).mockResolvedValue({ ...mockTrade, status: 'DELIVERED' });
    await useTradeStore.getState().confirmDelivery('trade-123');
    expect(useTradeStore.getState().currentTrade?.status).toBe('DELIVERED');
  });

  it('releaseFunds requires biometric authorization', async () => {
    (biometric.authorizeSensitiveAction as jest.Mock).mockResolvedValue(false);
    useTradeStore.setState({ currentTrade: mockTrade as any });
    await useTradeStore.getState().releaseFunds('trade-123');
    expect(tradeApi.releaseFunds).not.toHaveBeenCalled();
    expect(useTradeStore.getState().error).toBe('Authentication cancelled');
  });

  it('releaseFunds calls API when authorized', async () => {
    useTradeStore.setState({ currentTrade: mockTrade as any });
    (tradeApi.releaseFunds as jest.Mock).mockResolvedValue({ unsignedXdr: 'xdr' });
    (tradeApi.getTrade as jest.Mock).mockResolvedValue({ ...mockTrade, status: 'COMPLETED' });
    await useTradeStore.getState().releaseFunds('trade-123');
    expect(tradeApi.releaseFunds).toHaveBeenCalledWith('trade-123');
    expect(useTradeStore.getState().currentTrade?.status).toBe('COMPLETED');
  });

  it('deposit calls API and refreshes current trade', async () => {
    useTradeStore.setState({ currentTrade: mockTrade as any });
    (tradeApi.deposit as jest.Mock).mockResolvedValue({ unsignedXdr: 'xdr' });
    (tradeApi.getTrade as jest.Mock).mockResolvedValue({ ...mockTrade, status: 'FUNDED' });
    await useTradeStore.getState().deposit('trade-123');
    expect(tradeApi.deposit).toHaveBeenCalledWith('trade-123');
    expect(useTradeStore.getState().currentTrade?.status).toBe('FUNDED');
  });

  it('initiateDispute updates currentTrade', async () => {
    (biometric.authorizeSensitiveAction as jest.Mock).mockResolvedValue(true);
    (tradeApi.initiateDispute as jest.Mock).mockResolvedValue({ ...mockTrade, status: 'DISPUTED' });
    await useTradeStore.getState().initiateDispute('trade-123', 'reason');
    expect(useTradeStore.getState().currentTrade?.status).toBe('DISPUTED');
  });

  it('clearError resets the error state', () => {
    useTradeStore.setState({ error: 'some error' });
    useTradeStore.getState().clearError();
    expect(useTradeStore.getState().error).toBeNull();
  });
});
