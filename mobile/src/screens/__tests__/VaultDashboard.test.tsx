import { render, waitFor } from '@testing-library/react-native';
import VaultDashboard from '../VaultDashboard';
import { useTradeStore } from '../../stores/tradeStore';
import { useAuthStore } from '../../stores/authStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('VaultDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTradeStore.setState({
      trades: [],
      total: 0,
      currentTrade: null,
      isLoading: false,
      error: null,
      fetchTrades: jest.fn().mockResolvedValue(undefined),
    });
    useAuthStore.setState({ token: null, walletAddress: null, isLoading: false });
  });

  it('renders the dashboard header', () => {
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('Vault Dashboard')).toBeTruthy();
  });

  it('renders empty state when there are no trades', () => {
    useTradeStore.setState({ trades: [], isLoading: false });
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('No trades yet')).toBeTruthy();
  });

  it('renders active trade stats and totals', () => {
    useTradeStore.setState({
      trades: [
        { id: 1, tradeId: 't1', amountUsdc: '100', status: 'FUNDED' },
        { id: 2, tradeId: 't2', amountUsdc: '250', status: 'IN_TRANSIT' },
        { id: 3, tradeId: 't3', amountUsdc: '50', status: 'COMPLETED' },
      ] as any,
      isLoading: false,
    });
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('$350.00')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
  });

  it('shows loading skeleton while loading', () => {
    useTradeStore.setState({ trades: [], isLoading: true });
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('Vault Dashboard')).toBeTruthy();
  });

  it('shows error state with retry button', () => {
    useTradeStore.setState({ trades: [], isLoading: false, error: 'Failed to load' });
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('Failed to load')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('shows connected address badge when wallet is connected', () => {
    useAuthStore.setState({ walletAddress: 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3' });
    useTradeStore.setState({ trades: [], isLoading: false });
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('GA4T33…Y2Z3')).toBeTruthy();
  });

  it('shows not connected when wallet is absent', () => {
    useTradeStore.setState({ trades: [], isLoading: false });
    const { getByText } = render(<VaultDashboard />);
    expect(getByText('Not connected')).toBeTruthy();
  });

  it('refetches trades on pull to refresh', async () => {
    const fetchTrades = jest.fn().mockResolvedValue(undefined);
    useTradeStore.setState({ trades: [], isLoading: false, fetchTrades: fetchTrades as any });
    const { getByTestId, UNSAFE_getByType } = render(<VaultDashboard />);
    const { RefreshControl } = require('react-native');
    const refreshControl = UNSAFE_getByType(RefreshControl);
    refreshControl.props.onRefresh();
    await waitFor(() => expect(fetchTrades).toHaveBeenCalled());
    expect(getByTestId).toBeDefined();
  });
});
