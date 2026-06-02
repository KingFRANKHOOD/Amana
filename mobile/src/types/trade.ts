export type TradeStatus =
  | 'PENDING'
  | 'FUNDED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'DISPUTED'
  | 'COMPLETED'
  | 'REFUNDED';

export interface Trade {
  id: number;
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  status: TradeStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface TradeListResult {
  trades: Trade[];
  total: number;
  page: number;
  limit: number;
}
