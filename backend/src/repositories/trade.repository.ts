import type { TradeRecord } from "../types/trade";

const trades = new Map<string, TradeRecord>();

export const tradeRepository = {
  getById(id: string): TradeRecord | null {
    return trades.get(id) ?? null;
  },

  upsert(record: TradeRecord): void {
    trades.set(record.id, record);
  },

  /** Test helper */
  clear(): void {
    trades.clear();
  },
};
