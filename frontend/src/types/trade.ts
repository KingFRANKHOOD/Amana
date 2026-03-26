// src/types/trade.ts

export type TradeStatus =
  | "IN TRANSIT"
  | "PENDING"
  | "SETTLED"
  | "DISPUTED"
  | "DRAFT";

export interface TradeParty {
  name: string;
  walletAddress: string;
  trustScore: number;
  avatar?: string;
}

export interface TimelineEvent {
  id: string;
  type: "escrow_funded" | "inspection_passed" | "dispatched" | "settlement";
  title: string;
  description?: string;
  timestamp?: string;
  status: "completed" | "current" | "pending";
  tracking?: {
    trackingNumber: string;
    imageUrl?: string;
  };
}

export interface LossRatio {
  label: string;
  value: number; // percentage 0-100
}

export interface TradeDetail {
  id: string;
  commodity: string;
  quantity: string; // e.g. "20 Tons Non-GMO"
  category: string; // e.g. "Grains / Legumes"
  status: TradeStatus;
  initiatedAt: string;

  buyer: TradeParty;
  seller: TradeParty;

  // Financials
  vaultAmountLocked: number;
  assetValue: number;
  platformFeePercent: number;
  platformFee: number;
  networkGasEst: string;

  // Contract
  contractId: string;
  incoterms: string;
  originPort: string;
  destinationPort: string;
  eta: string;
  etaLabel?: string;
  carrier: string;

  // Timeline
  timeline: TimelineEvent[];

  // Optional loss ratios
  lossRatios?: LossRatio[];
}
