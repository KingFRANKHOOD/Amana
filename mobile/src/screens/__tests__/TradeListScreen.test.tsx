import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TradeListScreen from '../TradeListScreen';
import { useTradeStore } from '../../stores/tradeStore';
import { useAuthStore } from '../../stores/authStore';
import * as offlineQueue from '../../services/offline-queue';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/OfflineBanner', () => {
  const { View } = require('react-native');
  return { OfflineBanner: () => <View /> };
});

jest.mock('../../services/offline-queue', () => ({
  offlineQueue: {
    subscribe: jest.fn(),
    process: jest.fn(),
  },
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

const mockTrades = [
  {
    id: 1,
    tradeId: 'trade-123',
    buyerAddress: 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU',
    sellerAddress: 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3',
    amountUsdc: '100.00',
    status: 'PENDING',
  },
  {
    id: 2,
    tradeId: 'trade-456',
    buyerAddress: 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU',
    sellerAddress: 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3',
    amountUsdc: '250.00',
    status: 'FUNDED',
  },
];

describe('TradeListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTradeStore.setState({
      trades: [],
      total: 0,
      currentTrade: null,
      isLoading: false,
      error: null,
      fetchTrades: jest.fn().mockResolvedValue(undefined),
      clearError: jest.fn(),
    });
    useAuthStore.setState({ token: null, walletAddress: null, isLoading: false });
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockReturnValue(jest.fn());
  });

  it('renders the header title', () => {
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('🌾 Trades')).toBeTruthy();
  });

  it('renders a list of trades', () => {
    useTradeStore.setState({ trades: mockTrades as any, isLoading: false, fetchTrades: jest.fn() as any });
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('#trade-12')).toBeTruthy();
    expect(getByText('PENDING')).toBeTruthy();
    expect(getByText('100.00 USDC')).toBeTruthy();
  });

  it('shows an empty state when there are no trades', () => {
    useTradeStore.setState({ trades: [], isLoading: false, fetchTrades: jest.fn() as any });
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('No trades found')).toBeTruthy();
  });

  it('shows a loading indicator while loading', () => {
    useTradeStore.setState({ trades: [], isLoading: true, fetchTrades: jest.fn() as any });
    const { UNSAFE_getByType } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('navigates to trade detail when a trade card is pressed', () => {
    useTradeStore.setState({ trades: mockTrades as any, isLoading: false, fetchTrades: jest.fn() as any });
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    fireEvent.press(getByText('#trade-12'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('TradeDetail', { tradeId: 'trade-123' });
  });

  it('calls fetchTrades on filter change', async () => {
    const fetchTrades = jest.fn().mockResolvedValue(undefined);
    useTradeStore.setState({ trades: [], isLoading: false, fetchTrades: fetchTrades as any });
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    fireEvent.press(getByText('Pending'));
    await waitFor(() => expect(fetchTrades).toHaveBeenCalledWith({ status: 'PENDING' }));
  });

  it('calls login flow via logout', async () => {
    const clearAuth = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ token: null, walletAddress: null, isLoading: false, clearAuth: clearAuth as any });
    useTradeStore.setState({ trades: [], isLoading: false });
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    fireEvent.press(getByText('Logout'));
    await waitFor(() => {
      expect(clearAuth).toHaveBeenCalled();
      expect(mockNavigation.replace).toHaveBeenCalledWith('WalletConnect');
    });
  });

  it('shows an error banner when an error is present', () => {
    useTradeStore.setState({ trades: [], isLoading: false, error: 'Failed to load' });
    const { getByText } = render(<TradeListScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText(/Failed to load/)).toBeTruthy();
  });
});
