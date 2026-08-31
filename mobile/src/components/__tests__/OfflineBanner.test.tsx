import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { OfflineBanner } from '../OfflineBanner';
import * as Network from 'expo-network';
import * as offlineQueue from '../../services/offline-queue';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
}));

jest.mock('../../services/offline-queue', () => ({
  offlineQueue: {
    subscribe: jest.fn(),
  },
}));

describe('OfflineBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockReturnValue(jest.fn());
  });

  it('returns null when online with no queued items', async () => {
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      setTimeout(() => cb([]), 0);
      return jest.fn();
    });
    const { queryByText } = render(<OfflineBanner />);
    await waitFor(() => {
      expect(queryByText('Offline Mode Active')).toBeNull();
      expect(queryByText(/pending sync/)).toBeNull();
    });
  });

  it('shows offline mode when network is offline', async () => {
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: false, isInternetReachable: false });
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      setTimeout(() => cb([]), 0);
      return jest.fn();
    });
    const { getByText } = render(<OfflineBanner />);
    await waitFor(() => expect(getByText('Offline Mode Active')).toBeTruthy());
  });

  it('shows pending draft count with queue button', async () => {
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      setTimeout(
        () =>
          cb([
            { id: '1', status: 'pending', type: 'CREATE_TRADE', payload: {}, createdAt: '', retryCount: 0, lastError: null },
            { id: '2', status: 'pending', type: 'CREATE_TRADE', payload: {}, createdAt: '', retryCount: 0, lastError: null },
          ]),
        0
      );
      return jest.fn();
    });
    const onPressQueue = jest.fn();
    const { getByText } = render(<OfflineBanner onPressQueue={onPressQueue} />);
    await waitFor(() => expect(getByText('2 drafts pending sync')).toBeTruthy());
    fireEvent.press(getByText('Queue (2)'));
    expect(onPressQueue).toHaveBeenCalled();
  });

  it('shows failed draft count', async () => {
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      setTimeout(
        () =>
          cb([
            { id: '1', status: 'failed', type: 'CREATE_TRADE', payload: {}, createdAt: '', retryCount: 1, lastError: 'err' },
          ]),
        0
      );
      return jest.fn();
    });
    const { getByText } = render(<OfflineBanner />);
    await waitFor(() => expect(getByText('1 draft failed to sync')).toBeTruthy());
  });
});
