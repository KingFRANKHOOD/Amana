import { Router, Request, Response } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";
import { cacheGet, cacheSet } from "../lib/cache";
import { validateRequest } from "../middleware/validateRequest";

const assetCodeParamsSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{1,12}$/, "Invalid asset code"),
});

const assetQuerySchema = z.object({
  issuer: z.string().refine((value: string) => StrKey.isValidEd25519PublicKey(value), {
    message: "Invalid Stellar asset issuer",
  }).optional(),
});

const ASSET_CACHE_TTL = 300; // 5 minutes

interface AssetRecord {
  code: string;
  issuer: string;
  supply: string;
  authRequired: boolean;
  authRevocable: boolean;
  authClawbackEnabled: boolean;
  numAccounts: number;
}

function parseAsset(raw: any): AssetRecord {
  return {
    code: raw.asset_code ?? "XLM",
    issuer: raw.asset_issuer ?? "",
    supply: raw.amount ?? "0",
    authRequired: raw.flags?.auth_required ?? false,
    authRevocable: raw.flags?.auth_revocable ?? false,
    authClawbackEnabled: raw.flags?.auth_clawback_enabled ?? false,
    numAccounts: raw.accounts?.authorized ?? 0,
  };
}

export function createStellarAssetRouter(): Router {
  const router = Router();

  // GET /stellar/assets?issuer=<address>
  router.get("/", validateRequest({ query: assetQuerySchema }), async (req: Request, res: Response) => {
    const issuer = req.query.issuer as string | undefined;
    const cacheKey = `stellar:assets:${issuer ?? "all"}`;

    const cached = await cacheGet<AssetRecord[]>(cacheKey);
    if (cached) {
      res.json({ assets: cached, cached: true });
      return;
    }

    try {
      let builder = horizonServer.assets();
      if (issuer) {
        builder = builder.forIssuer(issuer);
      }
      const response = await builder.limit(200).call();
      const assets = response.records.map(parseAsset);

      await cacheSet(cacheKey, assets, ASSET_CACHE_TTL);
      res.json({ assets, cached: false });
    } catch (error) {
      appLogger.error({ error, issuer }, "Failed to fetch Stellar assets");
      res.status(502).json({ error: "Failed to fetch asset data from Stellar network" });
    }
  });

  // GET /stellar/assets/:code?issuer=<address>
  router.get("/:code", validateRequest({ params: assetCodeParamsSchema, query: assetQuerySchema }), async (req: Request, res: Response) => {
    const code = req.params.code as string;
    const issuer = req.query.issuer as string | undefined;
    const cacheKey = `stellar:assets:${code}:${issuer ?? "any"}`;

    const cached = await cacheGet<AssetRecord[]>(cacheKey);
    if (cached) {
      res.json({ assets: cached, cached: true });
      return;
    }

    try {
      let builder = horizonServer.assets().forCode(code);
      if (issuer) {
        builder = builder.forIssuer(issuer);
      }
      const response = await builder.limit(200).call();
      const assets = response.records.map(parseAsset);

      if (assets.length === 0) {
        res.status(404).json({ error: `No assets found with code '${code}'` });
        return;
      }

      await cacheSet(cacheKey, assets, ASSET_CACHE_TTL);
      res.json({ assets, cached: false });
    } catch (error) {
      appLogger.error({ error, code, issuer }, "Failed to fetch Stellar asset by code");
      res.status(502).json({ error: "Failed to fetch asset data from Stellar network" });
    }
  });

  return router;
}

export const stellarAssetRoutes = createStellarAssetRouter();
