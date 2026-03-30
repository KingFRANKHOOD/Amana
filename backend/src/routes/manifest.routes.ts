import { Router, Response } from "express";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { ManifestService, ManifestForbiddenError, ManifestConflictError, ManifestTradeStatusError, ManifestTradeNotFoundError } from "../services/manifest.service";
import { ContractService } from "../services/contract.service";
import { appLogger } from "../middleware/logger";

const manifestBodySchema = z.object({
    driverName: z.string().min(1),
    driverIdNumber: z.string().min(1),
    vehicleRegistration: z.string().min(1),
    routeDescription: z.string().min(1),
    expectedDeliveryAt: z.string().datetime(),
});

export function createManifestRouter(
    manifestService = new ManifestService(),
    contractService = new ContractService(),
) {
    const router = Router({ mergeParams: true });

    // POST /trades/:id/manifest
    router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
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
            appLogger.error({ err }, "[ManifestRoute] Error");
            res.status(500).json({ error: "Failed to submit manifest" });
        }
    });

    return router;
}
