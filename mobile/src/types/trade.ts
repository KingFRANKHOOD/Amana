export type TradeStatus =
  | 'PENDING_SIGNATURE'
  | 'CREATED'
  | 'FUNDED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface Trade {
  id: number;
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  status: TradeStatus;
  createdAt?: string;
  updatedAt?: string;
  buyerLossBps?: number;
  sellerLossBps?: number;
  commodity?: string;
  quantity?: string;
  unit?: string;
}

export interface TradeListResult {
  trades: Trade[];
  total: number;
  page: number;
  limit: number;
}
