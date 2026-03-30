import { createQueryString, request } from "./client";
import type { PathPaymentQuote } from "./types";

export const walletApi = {
  getBalance: (token: string) =>
    request<{ balance: string; asset: string }>("/wallet/balance", { token }),

  getPathPaymentQuote: (
    sourceAmount: string,
    sourceAsset: string,
    sourceAssetIssuer?: string,
  ) =>
    request<{ routes: PathPaymentQuote[] }>(
      `/wallet/path-payment-quote${createQueryString({
        sourceAmount,
        sourceAsset,
        sourceAssetIssuer,
      })}`,
    ),
};
