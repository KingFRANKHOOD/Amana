import { NextFunction, Router, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import {
    ManifestService,
    ManifestForbiddenError,
    ManifestConflictError,
    ManifestTradeStatusError,
    ManifestTradeNotFoundError,
    ManifestAccessDeniedError,
    ManifestNotFoundError,
} from "../services/manifest.service";
import { ContractService } from "../services/contract.service";

const manifestBodySchema = z.object({
    driverName: z.string().min(1),
    driverIdNumber: z.string().min(1),
    vehicleRegistration: z.string().min(1),
    routeDescription: z.string().min(1),
    expectedDeliveryAt: z.string().datetime(),
});

/**
 * Router for the driverIdNumber-aware manifest flow.
 *
 * NOTE: This router is mounted on the same path as createTradeManifestRouter()
 * (see app.ts). Because Express dispatches to the first matching router and
 * createTradeManifestRouter() always responds for GET/POST "/", this router's
 * handlers were previously unreachable dead code. To make them reachable
 * without breaking the existing trade.manifest.routes.ts consumers, the
 * handlers are also exposed under the distinct "/manifest-v2" sub-path, which
 * app.ts mounts alongside the legacy router.
 */
export function createManifestRouter(
    manifestService = new ManifestService(),
    contractService = new ContractService(),
) {
    const router = Router({ mergeParams: true });

    const getManifestHandler = async (
        req: AuthRequest,
        res: Response,
        next: NextFunction,
    ) => {
        const callerAddress = req.user?.walletAddress;
        if (!callerAddress) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        try {
            const manifest = await manifestService.getManifestByTradeId(
                req.params.id as string,
                callerAddress,
            );
            res.status(200).json(manifest);
        } catch (err) {
            if (
                err instanceof ManifestTradeNotFoundError ||
                err instanceof ManifestNotFoundError
            ) {
                res.status(404).json({ error: err.message });
                return;
            }
            if (err instanceof ManifestAccessDeniedError) {
                res.status(403).json({ error: err.message });
                return;
            }
            return next(err);
        }
    };

    const postManifestHandler = async (
        req: AuthRequest,
        res: Response,
        next: NextFunction,
    ) => {
        const callerAddress = req.user?.walletAddress;
        if (!callerAddress) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const parsed = manifestBodySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.flatten().fieldErrors });
            return;
        }

        const tradeId = req.params.id as string;

        try {
            const { manifestId, driverNameHash, driverIdHash } =
                await manifestService.submitManifest({
                    tradeId,
                    callerAddress,
                    ...parsed.data,
                });

            const { unsignedXdr } = await contractService.buildSubmitManifestTx({
                tradeId,
                sellerAddress: callerAddress,
                driverNameHash,
                driverIdHash,
            });

            res.status(201).json({ manifestId, unsignedXdr });
        } catch (err) {
            if (
                err instanceof ManifestForbiddenError ||
                err instanceof ManifestConflictError ||
                err instanceof ManifestTradeStatusError ||
                err instanceof ManifestTradeNotFoundError
            ) {
                res.status((err as any).status).json({ error: err.message });
                return;
            }
            return next(err);
        }
    };

    // GET /trades/:id/manifest
    router.get("/", authMiddleware, getManifestHandler);

    // POST /trades/:id/manifest
    router.post("/", authMiddleware, postManifestHandler);

    // GET /trades/:id/manifest-v2 — reachable alias for the driverIdNumber-aware flow
    router.get("/manifest-v2", authMiddleware, getManifestHandler);

    // POST /trades/:id/manifest-v2 — reachable alias for the driverIdNumber-aware flow
    router.post("/manifest-v2", authMiddleware, postManifestHandler);

    return router;
}
