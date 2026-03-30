import { authApi } from "./api/auth";
import { ApiError } from "./api/client";
import { getApiBaseUrl, getStellarNetworkPassphrase, getStellarRpcUrl } from "./api/env";
import { tradesApi } from "./api/trades";
import { walletApi } from "./api/wallet";

export type {
  ChallengeResponse,
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  EvidenceRecord,
  EvidenceResponse,
  PathPaymentQuote,
  TradeHistoryEvent,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
  VerifyResponse,
} from "./api/types";

export const api = {
  auth: authApi,
  trades: tradesApi,
  wallet: walletApi,
};

export const apiConfig = {
  getBaseUrl: getApiBaseUrl,
  getStellarRpcUrl,
  getStellarNetworkPassphrase,
};

export { ApiError };
