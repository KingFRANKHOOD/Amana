/**
 * Type definitions for Soroban contract event processing.
 * Maps to the on-chain TradeStatus enum defined in contracts/amana_escrow/src/lib.rs.
 */

export enum EventType {
  TradeCreated = "TradeCreated",
  TradeFunded = "TradeFunded",
  DeliveryConfirmed = "DeliveryConfirmed",
  FundsReleased = "FundsReleased",
  DisputeInitiated = "DisputeInitiated",
  DisputeResolved = "DisputeResolved",
}

export enum TradeStatus {
  CREATED = "CREATED",
  FUNDED = "FUNDED",
  DELIVERED = "DELIVERED",
  COMPLETED = "COMPLETED",
  DISPUTED = "DISPUTED",
  CANCELLED = "CANCELLED",
}

/** Mapping from EventType to the resulting TradeStatus */
export const EVENT_TO_STATUS: Record<EventType, TradeStatus> = {
  [EventType.TradeCreated]: TradeStatus.CREATED,
  [EventType.TradeFunded]: TradeStatus.FUNDED,
  [EventType.DeliveryConfirmed]: TradeStatus.DELIVERED,
  [EventType.FundsReleased]: TradeStatus.COMPLETED,
  [EventType.DisputeInitiated]: TradeStatus.DISPUTED,
  [EventType.DisputeResolved]: TradeStatus.CANCELLED,
};

export interface ParsedEvent {
  eventType: EventType;
  tradeId: string;
  ledgerSequence: number;
  /** Raw data payload from Soroban event */
  data: Record<string, unknown>;
}

export interface SorobanContractEvent {
  type: string;
  ledger: number;
  contractId: string;
  id: string;
  topic: { type: string; value: string }[];
  value: { type: string; value: unknown };
}
