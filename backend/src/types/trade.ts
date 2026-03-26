/** Off-chain trade record (DB mirror). Status updates after on-chain events per product flow. */
export type TradeDbStatus =
  | "CREATED"
  | "FUNDED"
  | "DELIVERED"
  | "COMPLETED";

export interface TradeRecord {
  id: string;
  /** Soroban `u64` trade id as a decimal string. */
  chainTradeId: string;
  buyerStellarAddress: string;
  sellerStellarAddress: string;
  status: TradeDbStatus;
}
