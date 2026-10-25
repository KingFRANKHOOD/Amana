import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CreateTradeScreen from '../CreateTradeScreen';
import { useTradeStore } from '../../stores/tradeStore';
import * as offlineQueue from '../../services/offline-queue';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../services/offline-queue', () => ({
  offlineQueue: {
    enqueue: jest.fn(),
    isOnline: jest.fn(),
  },
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

const validSeller = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';

describe('CreateTradeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTradeStore.setState({
      trades: [],
      total: 0,
      currentTrade: null,
      isLoading: false,
      error: null,
      createTrade: jest.fn(),
    });
  });

  it('renders step 1 by default', () => {
    const { getByText } = render(<CreateTradeScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('Step 1: Details')).toBeTruthy();
  });

  it('renders all commodity chips', () => {
    const { getByText } = render(<CreateTradeScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('Maize')).toBeTruthy();
    expect(getByText('Rice')).toBeTruthy();
    expect(getByText('Cassava')).toBeTruthy();
  });

  it('continue is disabled until form is valid', () => {
    const { getByText } = render(<CreateTradeScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    fireEvent.press(getByText('Continue'));
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('advances through steps when valid form submitted', () => {
    const { getByText, getByPlaceholderText } = render(
      <CreateTradeScreen navigation={mockNavigation as any} route={{ params: {} } as any} />
    );
    fireEvent.press(getByText('Maize'));
    fireEvent.changeText(getByPlaceholderText('e.g. 500'), '10');
    fireEvent.changeText(getByPlaceholderText('e.g. 450'), '100');
    fireEvent.changeText(getByPlaceholderText('G...'), validSeller);
    fireEvent.press(getByText('Continue'));
    expect(getByText('Step 2: Negotiation')).toBeTruthy();
    fireEvent.press(getByText('Review'));
    expect(getByText('Step 3: Review & Submit')).toBeTruthy();
  });

  it('saves a draft when offline', async () => {
    (offlineQueue.offlineQueue.isOnline as jest.Mock).mockResolvedValue(false);
    (offlineQueue.offlineQueue.enqueue as jest.Mock).mockResolvedValue({});
    useTradeStore.setState({ createTrade: jest.fn() as any });
    const { getByText, getByPlaceholderText, getAllByText } = render(
      <CreateTradeScreen navigation={mockNavigation as any} route={{ params: {} } as any} />
    );
    fireEvent.press(getByText('Maize'));
    fireEvent.changeText(getByPlaceholderText('e.g. 500'), '10');
    fireEvent.changeText(getByPlaceholderText('e.g. 450'), '100');
    fireEvent.changeText(getByPlaceholderText('G...'), validSeller);
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Review'));
    const submitButtons = getAllByText('Create Trade');
    fireEvent.press(submitButtons[submitButtons.length - 1]);
    await waitFor(() => {
      expect(offlineQueue.offlineQueue.enqueue).toHaveBeenCalled();
      expect(mockNavigation.replace).toHaveBeenCalledWith('TradeList');
    });
  });
});
