import { offlineService, initDb } from '../offline.service';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { tradeApi } from '../../api/trade';

// Mock expo-sqlite
jest.mock('expo-sqlite', () => {
  const mockRunAsync = jest.fn();
  const mockGetAllAsync = jest.fn();
  const mockGetFirstAsync = jest.fn();
  const mockExecAsync = jest.fn();
  const mockWithTransactionAsync = jest.fn(async (cb) => {
    await cb();
  });

  return {
    openDatabaseAsync: jest.fn().mockResolvedValue({
      execAsync: mockExecAsync,
      runAsync: mockRunAsync,
      getAllAsync: mockGetAllAsync,
      getFirstAsync: mockGetFirstAsync,
      withTransactionAsync: mockWithTransactionAsync,
    }),
  };
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => {
  let store: Record<string, string> = {};
  return {
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItemAsync: jest.fn(async (key: string) => {
      return store[key] || null;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
  };
});

// Mock react-native AppState
jest.mock('react-native', () => {
  const mockListeners = new Set<(mockStatus: string) => void>();
  return {
    AppState: {
      addEventListener: jest.fn((event: string, cb: (mockStatus: string) => void) => {
        mockListeners.add(cb);
        return {
          remove: jest.fn(() => mockListeners.delete(cb)),
        };
      }),
      // Test helper to simulate app state change
      emit: (mockStatus: string) => {
        mockListeners.forEach(cb => cb(mockStatus));
      },
    },
  };
});

// Mock tradeApi
jest.mock('../../api/trade', () => ({
  tradeApi: {
    listTrades: jest.fn(),
  },
}));

describe('Offline Service', () => {
  let mockDb: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb = await SQLite.openDatabaseAsync('amana_offline.db');
  });

  describe('SecureStore operations', () => {
    it('should save, read, and delete secure items', async () => {
      await offlineService.setSecureItem('token', 'auth-123');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('token', 'auth-123');

      const token = await offlineService.getSecureItem('token');
      expect(token).toBe('auth-123');
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('token');

      await offlineService.deleteSecureItem('token');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('token');
    });
  });

  describe('SQLite Cache operations', () => {
    const mockTrades = [
      { id: '1', sellerAddress: 'A1', amountUsdc: '100', status: 'OPEN' },
      { id: '2', sellerAddress: 'A2', amountUsdc: '200', status: 'LOCKED' },
    ];

    it('should cache list of trades', async () => {
      await offlineService.cacheTrades(mockTrades as any);

      expect(mockDb.runAsync).toHaveBeenCalledTimes(2);
      expect(mockDb.runAsync).toHaveBeenNthCalledWith(
        1,
        'INSERT OR REPLACE INTO trades (id, data, updated_at) VALUES (?, ?, ?)',
        ['1', JSON.stringify(mockTrades[0]), expect.any(Number)]
      );
    });

    it('should get cached trades', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { data: JSON.stringify(mockTrades[0]) },
        { data: JSON.stringify(mockTrades[1]) },
      ]);

      const cached = await offlineService.getCachedTrades();
      expect(cached).toEqual(mockTrades);
      expect(mockDb.getAllAsync).toHaveBeenCalledWith('SELECT data FROM trades ORDER BY updated_at DESC');
    });

    it('should cache and retrieve trade detail', async () => {
      await offlineService.cacheTradeDetail(mockTrades[0] as any);
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO trades (id, data, updated_at) VALUES (?, ?, ?)',
        ['1', JSON.stringify(mockTrades[0]), expect.any(Number)]
      );

      mockDb.getFirstAsync.mockResolvedValue({ data: JSON.stringify(mockTrades[0]) });
      const detail = await offlineService.getCachedTradeDetail('1');
      expect(detail).toEqual(mockTrades[0]);
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith('SELECT data FROM trades WHERE id = ?', ['1']);
    });

    it('should clear cache', async () => {
      await offlineService.clearCache();
      expect(mockDb.execAsync).toHaveBeenCalledWith('DELETE FROM trades');
    });
  });

  describe('Synchronization & Fallback Strategy', () => {
    const mockApiTrades = [
      { id: '3', sellerAddress: 'A3', amountUsdc: '300', status: 'OPEN' },
    ];

    it('should sync from API if online and update cache', async () => {
      (tradeApi.listTrades as jest.Mock).mockResolvedValue({ trades: mockApiTrades });

      const result = await offlineService.syncTrades(true);
      expect(result).toEqual(mockApiTrades);
      expect(tradeApi.listTrades).toHaveBeenCalled();
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO trades (id, data, updated_at) VALUES (?, ?, ?)',
        ['3', JSON.stringify(mockApiTrades[0]), expect.any(Number)]
      );
    });

    it('should serve cached data if offline', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { data: JSON.stringify({ id: 'cached-1' }) },
      ]);

      const result = await offlineService.syncTrades(false);
      expect(result).toEqual([{ id: 'cached-1' }]);
      expect(tradeApi.listTrades).not.toHaveBeenCalled();
    });

    it('should serve cached data if API call throws an error (network fallback)', async () => {
      (tradeApi.listTrades as jest.Mock).mockRejectedValue(new Error('Network offline'));
      mockDb.getAllAsync.mockResolvedValue([
        { data: JSON.stringify({ id: 'cached-1' }) },
      ]);

      const result = await offlineService.syncTrades(true);
      expect(result).toEqual([{ id: 'cached-1' }]);
      expect(tradeApi.listTrades).toHaveBeenCalled();
    });

    it('should listen to AppState change and trigger sync on foreground', async () => {
      const onSyncComplete = jest.fn();
      const checkOnlineStatus = jest.fn().mockResolvedValue(true);
      (tradeApi.listTrades as jest.Mock).mockResolvedValue({ trades: mockApiTrades });

      const removeListener = offlineService.setupForegroundSync(onSyncComplete, checkOnlineStatus);

      expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      // Trigger active event using mocked emit
      const emit = (AppState as any).emit;
      emit('active');

      // Wait for promises to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(checkOnlineStatus).toHaveBeenCalled();
      expect(onSyncComplete).toHaveBeenCalledWith(mockApiTrades);

      removeListener();
    });
  });
});
