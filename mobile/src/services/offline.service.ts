import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { AppState, AppStateStatus } from 'react-native';
import { tradeApi } from '../api/trade';
import type { Trade } from '../types/trade';

let db: SQLite.SQLiteDatabase | null = null;

export const initDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!db) {
    db = await SQLite.openDatabaseAsync('amana_offline.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
  return db;
};

export const offlineService = {
  // SecureStore helpers for auth tokens and small preferences
  async setSecureItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },

  async getSecureItem(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  async deleteSecureItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },

  // SQLite caching helpers for trades
  async cacheTrades(trades: Trade[]): Promise<void> {
    const database = await initDb();
    const now = Date.now();
    
    // Using a transaction for batch inserts
    await database.withTransactionAsync(async () => {
      for (const trade of trades) {
        await database.runAsync(
          'INSERT OR REPLACE INTO trades (id, data, updated_at) VALUES (?, ?, ?)',
          [trade.id, JSON.stringify(trade), now]
        );
      }
    });
  },

  async getCachedTrades(): Promise<Trade[]> {
    const database = await initDb();
    const rows = await database.getAllAsync<{ data: string }>('SELECT data FROM trades ORDER BY updated_at DESC');
    return rows.map(r => JSON.parse(r.data));
  },

  async cacheTradeDetail(trade: Trade): Promise<void> {
    const database = await initDb();
    const now = Date.now();
    await database.runAsync(
      'INSERT OR REPLACE INTO trades (id, data, updated_at) VALUES (?, ?, ?)',
      [trade.id, JSON.stringify(trade), now]
    );
  },

  async getCachedTradeDetail(tradeId: string): Promise<Trade | null> {
    const database = await initDb();
    const row = await database.getFirstAsync<{ data: string }>('SELECT data FROM trades WHERE id = ?', [tradeId]);
    return row ? JSON.parse(row.data) : null;
  },

  async clearCache(): Promise<void> {
    const database = await initDb();
    await database.execAsync('DELETE FROM trades');
  },

  // Sync strategy: fetches fresh data if online, falls back to cache
  async syncTrades(isOnline: boolean): Promise<Trade[]> {
    if (isOnline) {
      try {
        const result = await tradeApi.listTrades();
        const trades = result.trades || [];
        await this.cacheTrades(trades);
        return trades;
      } catch (error) {
        console.error('Failed to sync trades with network, using cache fallback:', error);
        return this.getCachedTrades();
      }
    } else {
      return this.getCachedTrades();
    }
  },

  // Set up listeners for app foregrounding to trigger auto-sync
  setupForegroundSync(onSyncComplete: (trades: Trade[]) => void, checkOnlineStatus: () => Promise<boolean>) {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        const online = await checkOnlineStatus();
        const trades = await this.syncTrades(online);
        onSyncComplete(trades);
      }
    });
    return () => subscription.remove();
  }
};
