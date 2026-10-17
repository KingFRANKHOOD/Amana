import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TradeDetailScreen from '../TradeDetailScreen';
import { useTradeStore } from '../../stores/tradeStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

const baseTrade = {
  id: 1,
  tradeId: 'trade-123',
  buyerAddress: 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU',
  sellerAddress: 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3',
  amountUsdc: '100.00',
  status: 'PENDING',
  buyerLossBps: 5000,
  sellerLossBps: 5000,
  commodity: 'Maize',
  quantity: '10',
  unit: 'kg',
};

describe('TradeDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTradeStore.setState({
      trades: [],
      total: 0,
      currentTrade: null,
      isLoading: false,
      error: null,
      fetchTrade: jest.fn().mockResolvedValue(undefined),
      confirmDelivery: jest.fn().mockResolvedValue(undefined),
      initiateDispute: jest.fn().mockResolvedValue(undefined),
      releaseFunds: jest.fn().mockResolvedValue(undefined),
      deposit: jest.fn().mockResolvedValue(undefined),
      clearError: jest.fn(),
    });
  });

  it('renders a loading indicator while fetching', () => {
    useTradeStore.setState({ isLoading: true, currentTrade: null });
    const { UNSAFE_getByType } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('shows an error message when trade is not found', () => {
    useTradeStore.setState({ currentTrade: null, isLoading: false, error: 'Trade not found' });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('Trade not found')).toBeTruthy();
  });

  it('renders trade details', () => {
    useTradeStore.setState({ currentTrade: baseTrade as any, isLoading: false });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('Trade Detail')).toBeTruthy();
    expect(getByText('100.00 USDC')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
  });

  it('shows Deposit Funds button for PENDING status', () => {
    useTradeStore.setState({ currentTrade: baseTrade as any, isLoading: false });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('💰 Deposit Funds')).toBeTruthy();
  });

  it('shows Confirm Delivery button for FUNDED status', () => {
    useTradeStore.setState({ currentTrade: { ...baseTrade, status: 'FUNDED' } as any, isLoading: false });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('✅ Confirm Delivery')).toBeTruthy();
    expect(getByText('⚠️ Initiate Dispute')).toBeTruthy();
  });

  it('shows Release Funds button for DELIVERED status', () => {
    useTradeStore.setState({ currentTrade: { ...baseTrade, status: 'DELIVERED' } as any, isLoading: false });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('💸 Release Funds')).toBeTruthy();
  });

  it('shows no actions for COMPLETED status', () => {
    useTradeStore.setState({ currentTrade: { ...baseTrade, status: 'COMPLETED' } as any, isLoading: false });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('No actions available for this trade status.')).toBeTruthy();
  });

  it('triggers deposit when Deposit Funds is pressed', async () => {
    const deposit = jest.fn().mockResolvedValue(undefined);
    useTradeStore.setState({ currentTrade: baseTrade as any, isLoading: false, deposit: deposit as any });
    const Alert = require('react-native').Alert;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((...args: any[]) => {
      const buttons = args[2] as any[] | undefined;
      if (buttons && buttons.length > 1 && buttons[1].onPress) {
        buttons[1].onPress();
      }
    });
    const { getByText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    fireEvent.press(getByText('💰 Deposit Funds'));
    await waitFor(() => expect(deposit).toHaveBeenCalledWith('trade-123'));
    alertSpy.mockRestore();
  });

  it('opens dispute modal and submits dispute', async () => {
    const initiateDispute = jest.fn().mockResolvedValue(undefined);
    useTradeStore.setState({ currentTrade: { ...baseTrade, status: 'FUNDED' } as any, isLoading: false, initiateDispute: initiateDispute as any });
    const { getByText, getByPlaceholderText } = render(
      <TradeDetailScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    fireEvent.press(getByText('⚠️ Initiate Dispute'));
    const input = getByPlaceholderText('e.g. Goods arrived damaged, quantity mismatch…');
    fireEvent.changeText(input, 'Goods damaged');
    fireEvent.press(getByText('Submit'));
    await waitFor(() => expect(initiateDispute).toHaveBeenCalledWith('trade-123', 'Goods damaged'));
  });
});
