import { Router, Request, Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";

const STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";

const HORIZON_URL =
  STELLAR_NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";

interface ParsedPayment {
  id: string;
  type: string;
  amount: string;
  asset: {
    code: string;
    issuer: string | null;
  };
  from: string;
  to: string;
  memo: string | null;
  createdAt: string;
  pagingToken: string;
}

function parsePayment(record: any): ParsedPayment {
  const assetType = record.asset_type;
  let assetCode: string;
  let assetIssuer: string | null;

  if (assetType === "native") {
    assetCode = "XLM";
    assetIssuer = null;
  } else {
    assetCode = record.asset_code ?? "";
    assetIssuer = record.asset_issuer ?? null;
  }

  let memo: string | null = null;
  if (record.memo) {
    memo = record.memo;
  } else if (record.transaction?.memo) {
    memo = record.transaction.memo;
  }

  return {
    id: record.id,
    type: record.type,
    amount: record.amount,
    asset: {
      code: assetCode,
      issuer: assetIssuer,
    },
    from: record.from,
    to: record.to,
    memo,
    createdAt: record.created_at,
    pagingToken: record.paging_token,
  };
}

function isValidAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

export function createPaymentHistoryRouter(): Router {
  const router = Router();

  router.get("/:address/payments", async (req: Request, res: Response) => {
    const address = req.params.address as string;

    if (!isValidAddress(address)) {
      res.status(400).json({ error: "Invalid Stellar account address" });
      return;
    }

    const cursor = (req.query.cursor as string) || "0";
    const limitParam = parseInt(req.query.limit as string, 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 20 : Math.min(limitParam, 100);

    try {
      const server = new StellarSdk.Horizon.Server(HORIZON_URL);

      const paymentsCall = server
        .payments()
        .forAccount(address)
        .cursor(cursor)
        .limit(limit)
        .order("desc");

      const response = await paymentsCall.call();

      const payments: ParsedPayment[] = response.records.map(parsePayment);

      const hasMore = response.records.length === limit;
      const nextCursor = hasMore
        ? response.records[response.records.length - 1].paging_token
        : null;

      res.json({
        payments,
        pagination: {
          nextCursor,
          hasMore,
          limit,
        },
      });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        res.json({ payments: [], pagination: { nextCursor: null, hasMore: false, limit } });
        return;
      }

      const msg = error instanceof Error ? error.message : String(error);
      res.status(502).json({
        error: "Failed to fetch payment history from Stellar network",
        details: msg,
      });
    }
  });

  return router;
}
