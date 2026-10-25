import * as SQLite from 'expo-sqlite';
import * as Network from 'expo-network';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { z } from 'zod';
import { tradeApi } from '../api/trade';
import { scheduleLocalNotification } from './notification.service';

const DATABASE_NAME = 'amana_offline.db';
const MAX_QUEUE_ITEMS = 50;
const BACKGROUND_TASK = 'amana-offline-queue-sync';

export type QueuedActionType = 'CREATE_TRADE' | 'SUBMIT_EVIDENCE' | 'INITIATE_DISPUTE';
export type QueuedActionStatus = 'pending' | 'processing' | 'failed';

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: Record<string, unknown>;
  createdAt: string;
  status: QueuedActionStatus;
  retryCount: number;
  lastError?: string | null;
}

const createTradePayloadSchema = z.object({
  sellerAddress: z.string().min(56),
  amountUsdc: z.string().min(1),
  buyerLossBps: z.number().int().min(0).max(10000).optional(),
  sellerLossBps: z.number().int().min(0).max(10000).optional(),
  commodity: z.string().optional(),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  deliveryDays: z.number().int().positive().optional(),
}).refine((value) => (value.buyerLossBps ?? 5000) + (value.sellerLossBps ?? 5000) === 10000, {
  message: 'Loss ratios must total 100%',
});

let db: SQLite.SQLiteDatabase | null = null;
let listenerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;
const subscribers = new Set<(items: QueuedAction[]) => void>();

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS offline_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS offline_queue_status_created_idx
        ON offline_queue(status, created_at);
    `);
  }
  return db;
}

function id(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapRow(row: {
  id: string;
  type: QueuedActionType;
  payload: string;
  created_at: string;
  status: QueuedActionStatus;
  retry_count: number;
  last_error?: string | null;
}): QueuedAction {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
  };
}

async function notifySubscribers(): Promise<void> {
  const items = await offlineQueue.list();
  subscribers.forEach((subscriber) => subscriber(items));
}

async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function executeAction(action: QueuedAction): Promise<void> {
  if (action.type === 'CREATE_TRADE') {
    const payload = createTradePayloadSchema.parse(action.payload);
    await tradeApi.createTrade(payload);
    return;
  }

  throw new Error(`${action.type} sync is not implemented yet`);
}

async function registerBackgroundTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (status !== BackgroundFetch.BackgroundFetchStatus.Available) return;

  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
  if (registered) return;

  await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
    minimumInterval: 15 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export const offlineQueue = {
  async init(): Promise<void> {
    await getDb();
    await registerBackgroundTask();
  },

  subscribe(callback: (items: QueuedAction[]) => void): () => void {
    subscribers.add(callback);
    void this.list().then(callback);
    return () => subscribers.delete(callback);
  },

  async enqueue(type: QueuedActionType, payload: Record<string, unknown>): Promise<QueuedAction> {
    if (type === 'SUBMIT_EVIDENCE' || type === 'INITIATE_DISPUTE') {
      throw new Error(`${type} sync is not implemented yet`);
    }

    if (type === 'CREATE_TRADE') {
      createTradePayloadSchema.parse(payload);
    }

    const database = await getDb();
    const count = await this.pendingCount();
    if (count >= MAX_QUEUE_ITEMS) {
      throw new Error(`Offline queue limit reached (${MAX_QUEUE_ITEMS} items)`);
    }

    const action: QueuedAction = {
      id: id(),
      type,
      payload,
      createdAt: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
      lastError: null,
    };

    await database.runAsync(
      'INSERT INTO offline_queue (id, type, payload, created_at, status, retry_count, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [action.id, action.type, JSON.stringify(action.payload), action.createdAt, action.status, action.retryCount, action.lastError],
    );
    await notifySubscribers();
    return action;
  },

  async list(): Promise<QueuedAction[]> {
    const database = await getDb();
    const rows = await database.getAllAsync<Parameters<typeof mapRow>[0]>(
      'SELECT id, type, payload, created_at, status, retry_count, last_error FROM offline_queue ORDER BY created_at ASC',
    );
    return rows.map(mapRow);
  },

  async pendingCount(): Promise<number> {
    const database = await getDb();
    const row = await database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM offline_queue WHERE status IN ('pending', 'processing', 'failed')",
    );
    return row?.count ?? 0;
  },

  async retry(id: string): Promise<void> {
    const database = await getDb();
    await database.runAsync(
      "UPDATE offline_queue SET status = 'pending', last_error = NULL WHERE id = ?",
      [id],
    );
    await notifySubscribers();
    await this.process();
  },

  async remove(id: string): Promise<void> {
    const database = await getDb();
    await database.runAsync('DELETE FROM offline_queue WHERE id = ?', [id]);
    await notifySubscribers();
  },

  async process(): Promise<{ synced: number; failed: number }> {
    if (processing || !(await isOnline())) {
      return { synced: 0, failed: 0 };
    }

    processing = true;
    let synced = 0;
    let failed = 0;

    try {
      const database = await getDb();
      const rows = await database.getAllAsync<Parameters<typeof mapRow>[0]>(
        "SELECT id, type, payload, created_at, status, retry_count, last_error FROM offline_queue WHERE status IN ('pending', 'failed') ORDER BY created_at ASC",
      );

      for (const action of rows.map(mapRow)) {
        await database.runAsync("UPDATE offline_queue SET status = 'processing' WHERE id = ?", [action.id]);
        await notifySubscribers();

        try {
          await executeAction(action);
          await database.runAsync('DELETE FROM offline_queue WHERE id = ?', [action.id]);
          synced += 1;
        } catch (error) {
          failed += 1;
          await database.runAsync(
            "UPDATE offline_queue SET status = 'failed', retry_count = retry_count + 1, last_error = ? WHERE id = ?",
            [(error as Error)?.message ?? 'Sync failed', action.id],
          );
        }
      }
    } finally {
      processing = false;
      await notifySubscribers();
    }

    if (synced > 0) {
      await scheduleLocalNotification(`${synced} trade${synced === 1 ? '' : 's'} synced`, 'Offline drafts were submitted successfully.', { type: 'trade' });
    }
    if (failed > 0) {
      await scheduleLocalNotification('Trade draft failed to sync', 'Tap the sync queue to retry or edit the draft.', { type: 'general', screen: 'SyncQueue' });
    }

    return { synced, failed };
  },

  startNetworkListener(): () => void {
    if (!listenerTimer) {
      listenerTimer = setInterval(() => {
        void isOnline().then((online) => {
          if (online) void this.process();
        });
      }, 15_000);
    }

    void this.process();

    return () => {
      if (listenerTimer) {
        clearInterval(listenerTimer);
        listenerTimer = null;
      }
    };
  },

  isOnline,
};

TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const result = await offlineQueue.process();
    return result.synced > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});
