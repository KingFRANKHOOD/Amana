/* eslint-disable no-undef, @typescript-eslint/no-explicit-any */
import { offlineQueue, QueuedAction } from '../offline-queue';
import { offlineService } from '../offline.service';
import * as SQLite from 'expo-sqlite';
import * as Network from 'expo-network';
import { tradeApi } from '../../api/trade';
import { scheduleLocalNotification } from '../notification.service';

jest.mock('expo-sqlite', () => {
  let mockTable: Record<string, any[]> = {
    offline_queue: [],
    trades: [],
  };

  const mockRunAsync = jest.fn(async (query: string, params: any[] = []) => {
    if (query.includes('INSERT INTO offline_queue')) {
      const [id, type, payload, created_at, status, retry_count, last_error] = params;
      mockTable.offline_queue.push({
        id,
        type,
        payload,
        created_at,
        status,
        retry_count: retry_count ?? 0,
        last_error: last_error ?? null,
      });
    } else if (query.includes("UPDATE offline_queue SET status = 'processing'")) {
      const id = params[0];
      const item = mockTable.offline_queue.find((r) => r.id === id);
      if (item) item.status = 'processing';
    } else if (query.includes("UPDATE offline_queue SET status = 'failed'")) {
      const [last_error, id] = params;
      const item = mockTable.offline_queue.find((r) => r.id === id);
      if (item) {
        item.status = 'failed';
        item.retry_count = (item.retry_count || 0) + 1;
        item.last_error = last_error;
      }
    } else if (query.includes("UPDATE offline_queue SET status = 'pending'")) {
      const id = params[0];
      const item = mockTable.offline_queue.find((r) => r.id === id);
      if (item) {
        item.status = 'pending';
        item.last_error = null;
      }
    } else if (query.includes('DELETE FROM offline_queue WHERE id = ?')) {
      const id = params[0];
      mockTable.offline_queue = mockTable.offline_queue.filter((r) => r.id !== id);
    } else if (query.includes('INSERT OR REPLACE INTO trades')) {
      const [id, data, updated_at] = params;
      const idx = mockTable.trades.findIndex((t) => t.id === id);
      if (idx >= 0) {
        mockTable.trades[idx] = { id, data, updated_at };
      } else {
        mockTable.trades.push({ id, data, updated_at });
      }
    }
  });

  const mockGetAllAsync = jest.fn(async (query: string) => {
    if (query.includes('FROM offline_queue')) {
      return [...mockTable.offline_queue];
    }
    if (query.includes('FROM trades')) {
      return [...mockTable.trades];
    }
    return [];
  });

  const mockGetFirstAsync = jest.fn(async (query: string, params: any[] = []) => {
    if (query.includes('COUNT(*) as count FROM offline_queue')) {
      return { count: mockTable.offline_queue.length };
    }
    if (query.includes('FROM trades WHERE id = ?')) {
      const item = mockTable.trades.find((t) => t.id === params[0]);
      return item || null;
    }
    return null;
  });

  const mockExecAsync = jest.fn(async () => {});
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
    __resetMockDb: () => {
      mockTable = { offline_queue: [], trades: [] };
    },
    __getMockTable: () => mockTable,
  };
});

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

jest.mock('expo-background-fetch', () => ({
  getStatusAsync: jest.fn().mockResolvedValue(1),
  registerTaskAsync: jest.fn().mockResolvedValue(undefined),
  BackgroundFetchStatus: { Available: 1 },
  BackgroundFetchResult: { NewData: 1, NoData: 2, Failed: 3 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('../notification.service', () => ({
  scheduleLocalNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../api/trade', () => ({
  tradeApi: {
    createTrade: jest.fn().mockResolvedValue({ tradeId: 'trade-synced-123' }),
    listTrades: jest.fn().mockResolvedValue({ trades: [] }),
  },
}));

describe('Comprehensive Mobile Offline Strategy & Conflict Resolution', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (SQLite as any).__resetMockDb();
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  describe('Offline Queue Enqueue & Validation', () => {
    const validSeller = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBMAOTQTVHXBMS7CW';

    it('enqueues a valid CREATE_TRADE action with pending status', async () => {
      const action = await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '500',
        commodity: 'Maize',
        quantity: '100',
        unit: 'kg',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(action).toBeDefined();
      expect(action.id).toBeDefined();
      expect(action.type).toBe('CREATE_TRADE');
      expect(action.status).toBe('pending');
      expect(action.retryCount).toBe(0);

      const items = await offlineQueue.list();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(action.id);
    });

    it('rejects invalid trade payload that violates loss ratio invariants', async () => {
      await expect(
        offlineQueue.enqueue('CREATE_TRADE', {
          sellerAddress: validSeller,
          amountUsdc: '500',
          buyerLossBps: 3000,
          sellerLossBps: 3000, // Totals 6000 != 10000
        }),
      ).rejects.toThrow();
    });

    it('notifies subscribers reactively when items are queued', async () => {
      const listener = jest.fn();
      const unsubscribe = offlineQueue.subscribe(listener);

      await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '100',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe('Queue Synchronization & Network State Transitions', () => {
    const validSeller = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBMAOTQTVHXBMS7CW';

    it('does not process queue when network is offline', async () => {
      (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      });

      await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '100',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      const result = await offlineQueue.process();
      expect(result.synced).toBe(0);
      expect(tradeApi.createTrade).not.toHaveBeenCalled();
    });

    it('successfully processes and clears queued action when online', async () => {
      (tradeApi.createTrade as jest.Mock).mockResolvedValue({ tradeId: 'trade-server-001' });

      await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '250',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      const result = await offlineQueue.process();
      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
      expect(tradeApi.createTrade).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerAddress: validSeller,
          amountUsdc: '250',
        }),
      );

      expect(scheduleLocalNotification).toHaveBeenCalledWith(
        '1 trade synced',
        'Offline drafts were submitted successfully.',
        { type: 'trade' },
      );

      const remaining = await offlineQueue.list();
      expect(remaining.length).toBe(0);
    });

    it('marks action as failed, increments retryCount, and sets lastError on network/API failure', async () => {
      (tradeApi.createTrade as jest.Mock).mockRejectedValue(new Error('Stellar network timeout'));

      const action = await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '300',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      const result = await offlineQueue.process();
      expect(result.failed).toBe(1);
      expect(result.synced).toBe(0);

      const items = await offlineQueue.list();
      const failedItem = items.find((i) => i.id === action.id);
      expect(failedItem?.status).toBe('failed');
      expect(failedItem?.retryCount).toBe(1);
      expect(failedItem?.lastError).toBe('Stellar network timeout');

      expect(scheduleLocalNotification).toHaveBeenCalledWith(
        'Trade draft failed to sync',
        'Tap the sync queue to retry or edit the draft.',
        { type: 'general', screen: 'SyncQueue' },
      );
    });

    it('allows manual retry of failed actions', async () => {
      (tradeApi.createTrade as jest.Mock).mockRejectedValueOnce(new Error('Server busy'));

      const action = await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '300',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      await offlineQueue.process();

      // Now server is healthy
      (tradeApi.createTrade as jest.Mock).mockResolvedValueOnce({ tradeId: 'trade-recovered-001' });

      await offlineQueue.retry(action.id);

      const items = await offlineQueue.list();
      expect(items.length).toBe(0); // Successfully processed and removed
    });

    it('allows deleting an action from the queue', async () => {
      const action = await offlineQueue.enqueue('CREATE_TRADE', {
        sellerAddress: validSeller,
        amountUsdc: '100',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      await offlineQueue.remove(action.id);

      const items = await offlineQueue.list();
      expect(items.length).toBe(0);
    });
  });

  describe('Offline Cache & Optimistic Concurrency', () => {
    it('caches and retrieves local trades seamlessly during network disruption', async () => {
      const sampleTrade = {
        id: 'trade-loc-1',
        tradeId: 'trade-loc-1',
        buyerAddress: 'G_BUYER',
        sellerAddress: 'G_SELLER',
        amountUsdc: '1000',
        status: 'FUNDED',
      };

      await offlineService.cacheTrades([sampleTrade as any]);
      const cached = await offlineService.getCachedTrades();
      expect(cached.length).toBe(1);
      expect(cached[0].tradeId).toBe('trade-loc-1');
    });
  });
});
