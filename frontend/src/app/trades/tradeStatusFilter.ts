/**
 * Mirrors the backend `TradeStatus` enum (backend/prisma/schema.prisma), which
 * GET /trades and GET /trades/export validate the `status` query param against.
 */
export const BACKEND_TRADE_STATUSES = [
  "PENDING_SIGNATURE",
  "CREATED",
  "FUNDED",
  "DELIVERED",
  "COMPLETED",
  "DISPUTED",
  "CANCELLED",
] as const;

export type BackendTradeStatus = (typeof BACKEND_TRADE_STATUSES)[number];

export type TradeStatus = "all" | "active" | "pending" | "completed" | "disputed";

export const TRADE_FILTER_STATUSES: readonly TradeStatus[] = [
  "all",
  "active",
  "pending",
  "completed",
  "disputed",
];

const FILTER_TO_BACKEND_STATUS: Record<Exclude<TradeStatus, "all">, BackendTradeStatus> = {
  active: "FUNDED",
  pending: "PENDING_SIGNATURE",
  completed: "COMPLETED",
  disputed: "DISPUTED",
};

/**
 * Map a UI filter tab to the backend status query value. Returns `undefined`
 * for "all" so no status filter is sent.
 */
export function toBackendStatus(status: TradeStatus): BackendTradeStatus | undefined {
  return status === "all" ? undefined : FILTER_TO_BACKEND_STATUS[status];
}
