import { Alert } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import CreateTradeScreen from '../../screens/CreateTradeScreen';

const mockEnqueue = jest.fn();
const mockIsOnline = jest.fn();
const mockCreateTrade = jest.fn();

jest.mock('../../services/offline-queue', () => ({
  offlineQueue: {
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
    isOnline: (...args: unknown[]) => mockIsOnline(...args),
  },
}));

jest.mock('../../stores/tradeStore', () => ({
  useTradeStore: () => ({ createTrade: mockCreateTrade }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const sellerAddress = 'GASTAG3O4FSBBGHETW5UW5CCNOG5VIYU3UPXJURFUUYP27KMF2BSIO5Y';

const navigation = {
  replace: jest.fn(),
  goBack: jest.fn(),
} as never;

function renderScreen() {
  return render(<CreateTradeScreen navigation={navigation} route={{} as never} />);
}

async function fillDetailsStep() {
  fireEvent.press(screen.getByText('Maize'));
  fireEvent.changeText(screen.getByPlaceholderText('e.g. 500'), '100');
  fireEvent.changeText(screen.getByPlaceholderText('e.g. 450'), '50');
  fireEvent.changeText(screen.getByPlaceholderText('G...'), sellerAddress);
  fireEvent.press(screen.getByText('Continue'));
}

describe('CreateTradeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsOnline.mockResolvedValue(true);
    mockCreateTrade.mockResolvedValue({ tradeId: 'T-42', unsignedXdr: 'xdr' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('includes the delivery window in the create-trade payload', async () => {
    renderScreen();

    await fillDetailsStep();
    fireEvent.changeText(screen.getByPlaceholderText('7'), '14');
    fireEvent.press(screen.getByText('Review'));

    // The review step must show the value that will be submitted.
    expect(screen.getByText('14 days')).toBeTruthy();

    // The header also reads "Create Trade"; the submit button is the last match.
    const createTradeButtons = screen.getAllByText('Create Trade');
    fireEvent.press(createTradeButtons[createTradeButtons.length - 1]);

    await waitFor(() => {
      expect(mockCreateTrade).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateTrade).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAddress,
        commodity: 'Maize',
        quantity: '100',
        unit: 'kg',
        deliveryDays: 14,
      }),
    );
  });

  it('keeps the delivery window when a draft is queued offline', async () => {
    mockIsOnline.mockResolvedValue(false);
    renderScreen();

    await fillDetailsStep();
    fireEvent.changeText(screen.getByPlaceholderText('7'), '3');
    fireEvent.press(screen.getByText('Review'));
    // The header also reads "Create Trade"; the submit button is the last match.
    const createTradeButtons = screen.getAllByText('Create Trade');
    fireEvent.press(createTradeButtons[createTradeButtons.length - 1]);

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });
    expect(mockEnqueue).toHaveBeenCalledWith(
      'CREATE_TRADE',
      expect.objectContaining({ deliveryDays: 3 }),
    );
    expect(mockCreateTrade).not.toHaveBeenCalled();
  });

  it('blocks the review step when the delivery window is empty', async () => {
    renderScreen();

    await fillDetailsStep();
    fireEvent.changeText(screen.getByPlaceholderText('7'), '');
    fireEvent.press(screen.getByText('Review'));

    // Still on step 2, so the review summary is not rendered.
    expect(screen.queryByText('Step 3: Review & Submit')).toBeNull();
  });
});
