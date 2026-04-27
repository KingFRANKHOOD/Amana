export interface ChallengeResponse {
  challenge: string;
}

export interface VerifyResponse {
  token: string;
}

export interface TradeResponse {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountCngn: string;
  buyerLossBps: number;
  sellerLossBps: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeListResponse {
  items: TradeResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TradeStatsResponse {
  totalTrades: number;
  totalVolume: number;
  openTrades: number;
}

export interface TradeHistoryEvent {
  eventType: string;
  timestamp: string;
  actor: string;
  metadata: Record<string, unknown>;
}

export interface TradeHistoryResponse {
  events: TradeHistoryEvent[];
}

export interface EvidenceRecord {
  id: string;
  cid: string;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
}

export interface EvidenceResponse {
  evidence: EvidenceRecord[];
}

export interface CreateTradeRequest {
  sellerAddress: string;
  amountCngn: string;
  buyerLossBps: number;
  sellerLossBps: number;
}

export interface CreateTradeResponse {
  tradeId: string;
  unsignedXdr: string;
}

export interface DepositResponse {
  unsignedXdr: string;
}

export interface PathPaymentQuote {
  source_amount: string;
  source_asset_type: string;
  source_asset_code?: string;
  destination_amount: string;
  destination_asset_type: string;
  destination_asset_code?: string;
  path: unknown[];
}

export interface DisputeResponse {
  id: number;
  tradeId: string;
  initiator: string;
  reason: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  trade: {
    buyerAddress: string;
    sellerAddress: string;
    amountUsdc: string;
  };
}

export interface DisputeListResponse {
  items: DisputeResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
