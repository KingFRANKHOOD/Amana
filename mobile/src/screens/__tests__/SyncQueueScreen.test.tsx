import { render, waitFor } from '@testing-library/react-native';
import SyncQueueScreen from '../SyncQueueScreen';
import * as offlineQueue from '../../services/offline-queue';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../services/offline-queue', () => ({
  offlineQueue: {
    subscribe: jest.fn(),
    process: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

const queuedItems = [
  {
    id: '1',
    type: 'CREATE_TRADE',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    retryCount: 0,
    lastError: null,
  },
  {
    id: '2',
    type: 'CREATE_TRADE',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'failed',
    retryCount: 1,
    lastError: 'Server error',
  },
];

describe('SyncQueueScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockReturnValue(jest.fn());
  });

  it('renders header and empty state', () => {
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      cb([]);
      return jest.fn();
    });
    const { getByText } = render(<SyncQueueScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('Sync Queue')).toBeTruthy();
    expect(getByText('All caught up')).toBeTruthy();
  });

  it('renders queued items', async () => {
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      setTimeout(() => cb(queuedItems as any), 0);
      return jest.fn();
    });
    const { getAllByText } = render(<SyncQueueScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    await waitFor(() => expect(getAllByText('CREATE TRADE').length).toBe(2));
    expect(getAllByText('Server error')).toBeTruthy();
    expect(getAllByText('Retry').length).toBe(1);
    expect(getAllByText('Delete').length).toBe(1);
  });

  it('triggers sync when Sync is pressed', () => {
    (offlineQueue.offlineQueue.subscribe as jest.Mock).mockImplementation((cb: any) => {
      cb([]);
      return jest.fn();
    });
    const { getByText } = render(<SyncQueueScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    getByText('Sync');
    expect(offlineQueue.offlineQueue.process).toBeDefined();
  });
});
