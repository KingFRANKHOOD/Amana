import { Router, Request, Response } from "express";
import { z } from "zod";
import * as StellarSdk from "@stellar/stellar-sdk";

const STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";

const networkPassphrase =
  STELLAR_NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const StrictReceiveSchema = z.object({
  sourceAccount: z.string().regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key"),
  destination: z.string().regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key"),
  destinationAmount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive decimal"),
  sourceMax: z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive decimal"),
  destinationAsset: z.object({
    code: z.string().min(1).max(12),
    issuer: z.string().regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key"),
  }),
  sourceAsset: z.object({
    code: z.string().min(1).max(12),
    issuer: z.string().regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key"),
  }).optional(),
  path: z.array(
    z.object({
      code: z.string().min(1).max(12),
      issuer: z.string().regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key"),
    })
  ).default([]),
  memo: z.string().max(28).optional(),
});

export function createStrictReceivePaymentRouter(): Router {
  const router = Router();

  router.post("/strict-receive", async (req: Request, res: Response) => {
    const parsed = StrictReceiveSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues,
      });
      return;
    }

    const {
      sourceAccount,
      destination,
      destinationAmount,
      sourceMax,
      destinationAsset,
      sourceAsset,
      path,
      memo,
    } = parsed.data;

    try {
      const server = new StellarSdk.Horizon.Server(
        STELLAR_NETWORK === "mainnet"
          ? "https://horizon.stellar.org"
          : "https://horizon-testnet.stellar.org"
      );

      const account = await server.loadAccount(sourceAccount);

      const destAsset = new StellarSdk.Asset(
        destinationAsset.code,
        destinationAsset.issuer
      );

      const srcAsset = sourceAsset
        ? new StellarSdk.Asset(sourceAsset.code, sourceAsset.issuer)
        : StellarSdk.Asset.native();

      const pathAssets = path.map(
        (p) => new StellarSdk.Asset(p.code, p.issuer)
      );

      const operation = StellarSdk.Operation.pathPaymentStrictReceive({
        destination,
        destAsset,
        destAmount: destinationAmount,
        sendAsset: srcAsset,
        sendMax: sourceMax,
        path: pathAssets,
      });

      const builder = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      });

      builder.addOperation(operation);

      if (memo) {
        builder.addMemo(StellarSdk.Memo.text(memo));
      }

      builder.setTimeout(180);

      const transaction = builder.build();

      res.json({
        envelopeXDR: transaction.toEnvelope().toXDR().toString("base64"),
        networkPassphrase,
      });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        res.status(404).json({ error: "Source account not found" });
        return;
      }

      const msg = error instanceof Error ? error.message : String(error);
      res.status(502).json({
        error: "Failed to build strict-receive path payment",
        details: msg,
      });
    }
  });

  return router;
}
