import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import {
  ManifestAccessDeniedError,
  ManifestConflictError,
  ManifestForbiddenError,
  ManifestNotFoundError,
  ManifestService,
  ManifestTradeNotFoundError,
  ManifestTradeStatusError,
} from "../services/manifest.service";
import { ContractService } from "../services/contract.service";
import { IPFSService, ServiceUnavailableError } from "../services/ipfs.service";

const deliveryWindowSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
}).refine((value: { from: string; to: string }) => new Date(value.from) < new Date(value.to), {
  message: "estimatedDeliveryWindow.from must be before estimatedDeliveryWindow.to",
  path: ["from"],
});

const tradeManifestBodySchema = z.object({
  driverName: z.string().trim().min(1),
  driverIdNumber: z.string().trim().min(1),
  phone: z.string().trim().min(5),
  licensePlate: z.string().trim().min(1),
  vehicleType: z.string().trim().min(1),
  estimatedDeliveryWindow: deliveryWindowSchema,
});

type ManifestContract = Pick<ContractService, "buildSubmitTradeManifestTx">;
type ManifestIpfs = Pick<IPFSService, "uploadFile">;

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

/**
 * Returns true when the request explicitly targets the driverIdNumber-aware
 * manifest contract flow (driverNameHash/driverIdHash + buildSubmitManifestTx).
 * This lets the app mount both manifest routers on the same path without the
 * trade manifest router shadowing this one for those requests.
 */
function wantsDriverIdManifest(req: AuthRequest): boolean {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === "object") {
    if (typeof body.driverIdHash === "string" || typeof body.driverNameHash === "string") {
      return true;
    }
  }
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query === "object") {
    if (query.flow === "driverId" || query.flow === "driver-id") {
      return true;
    }
  }
  return false;
}

export function createTradeManifestRouter(
  manifestService = new ManifestService(),
  contractService: ManifestContract = new ContractService(),
  ipfsService: ManifestIpfs = new IPFSService(),
) {
  const router = Router({ mergeParams: true });

  router.get("/", authMiddleware, async (req: AuthRequest, res: Response, next) => {
    // Defer to the driverIdNumber-aware manifest router when the caller
    // explicitly requests that flow, so it is no longer unreachable.
    if (wantsDriverIdManifest(req)) {
      next();
      return;
    }

    const walletAddress = caller(req, res);
    if (!walletAddress) return;

    try {
      const manifest = await manifestService.getManifestByTradeId(
        req.params.id as string,
        walletAddress,
      );
      res.status(200).json(manifest);
    } catch (error) {
      if (error instanceof ManifestTradeNotFoundError || error instanceof ManifestNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof ManifestAccessDeniedError) {
        res.status(403).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.post("/", authMiddleware, async (req: AuthRequest, res: Response, next) => {
    // Defer to the driverIdNumber-aware manifest router when the caller
    // explicitly requests that flow, so it is no longer unreachable.
    if (wantsDriverIdManifest(req)) {
      next();
      return;
    }

    const walletAddress = caller(req, res);
    if (!walletAddress) return;

    const parsed = tradeManifestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const tradeId = req.params.id as string;
    const manifestJson = {
      tradeId,
      sellerAddress: walletAddress,
      ...parsed.data,
      submittedAt: new Date().toISOString(),
    };

    try {
      const ipfsHash = await ipfsService.uploadFile(
        Buffer.from(JSON.stringify(manifestJson)),
        `trade-${tradeId}-manifest.json`,
      );

      const routeDescription = [
        `phone=${parsed.data.phone}`,
        `vehicleType=${parsed.data.vehicleType}`,
        `deliveryWindow=${parsed.data.estimatedDeliveryWindow.from}/${parsed.data.estimatedDeliveryWindow.to}`,
        `ipfsHash=${ipfsHash}`,
      ].join("; ");

      const { manifestId } = await manifestService.submitManifest({
        tradeId,
        callerAddress: walletAddress,
        driverName: parsed.data.driverName,
        driverIdNumber: parsed.data.driverIdNumber,
        vehicleRegistration: parsed.data.licensePlate,
        routeDescription,
        expectedDeliveryAt: parsed.data.estimatedDeliveryWindow.to,
      });

      const { unsignedXdr } = await contractService.buildSubmitTradeManifestTx({
        tradeId,
        sellerAddress: walletAddress,
        ipfsHash,
      });

      res.status(201).json({ manifestId, ipfsHash, unsignedXdr });
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (
        error instanceof ManifestForbiddenError ||
        error instanceof ManifestConflictError ||
        error instanceof ManifestTradeStatusError ||
        error instanceof ManifestTradeNotFoundError
      ) {
        res.status((error as any).status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}

export const tradeManifestRoutes = createTradeManifestRouter();
