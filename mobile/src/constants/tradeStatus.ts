import type { TradeStatus } from '../types/trade';

// Ordered to match the backend lifecycle:
// PENDING_SIGNATURE → CREATED → FUNDED → DELIVERED → COMPLETED,
// with DISPUTED / CANCELLED as side branches.
export const TRADE_STATUSES: readonly TradeStatus[] = [
  'PENDING_SIGNATURE',
  'CREATED',
  'FUNDED',
  'DELIVERED',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
];

// Trades that are still in flight and count toward the "locked" escrow total.
export const ACTIVE_TRADE_STATUSES: ReadonlySet<TradeStatus> = new Set<TradeStatus>([
  'PENDING_SIGNATURE',
  'CREATED',
  'FUNDED',
  'DELIVERED',
]);

export function isActiveTradeStatus(status: TradeStatus): boolean {
  return ACTIVE_TRADE_STATUSES.has(status);
}

export const STATUS_COLORS: Record<TradeStatus, string> = {
  PENDING_SIGNATURE: '#F59E0B',
  CREATED: '#8B5CF6',
  FUNDED: '#3B82F6',
  DELIVERED: '#14B8A6',
  COMPLETED: '#10B981',
  DISPUTED: '#EF4444',
  CANCELLED: '#6B7280',
};

export const STATUS_LABELS: Record<TradeStatus, string> = {
  PENDING_SIGNATURE: 'Pending Signature',
  CREATED: 'Created',
  FUNDED: 'Funded',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
};

export const DEFAULT_STATUS_COLOR = '#6B7280';
