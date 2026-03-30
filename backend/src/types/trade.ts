import type { TradeStatus } from "@prisma/client";

/** Off-chain trade record (DB mirror). Field names match Prisma `Trade`; status follows on-chain events. */
export interface TradeRecord {
  id: number;
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  status: TradeStatus;
}
