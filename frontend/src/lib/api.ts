import { authApi } from "./api/auth";
import { ApiError } from "./api/client";
import { disputesApi } from "./api/disputes";
import { getApiBaseUrl, getStellarNetworkPassphrase, getStellarRpcUrl } from "./api/env";
import { reputationApi } from "./api/reputation";
import { searchApi } from "./api/search";
import { tradesApi } from "./api/trades";
import { walletApi } from "./api/wallet";

export type {
  ChallengeResponse,
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  DisputeListResponse,
  DisputeResponse,
  EvidenceRecord,
  EvidenceResponse,
  PathPaymentQuote,
  ReputationResponse,
  SearchResponse,
  SearchResultItem,
  TradeHistoryEvent,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
  VerifyResponse,
} from "./api/types";

export const api = {
  auth: authApi,
  disputes: disputesApi,
  reputation: reputationApi,
  search: searchApi,
  trades: tradesApi,
  wallet: walletApi,
};

export const apiConfig = {
  getBaseUrl: getApiBaseUrl,
  getStellarRpcUrl,
  getStellarNetworkPassphrase,
};

export { ApiError };
