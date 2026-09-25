import { NextFunction, Router, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { tradeIdParamSchema } from "../schemas/trade.notes.schemas";
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

const noUnsafeHtml = (value: string) => !/[<>]/.test(value) && !/(?:on\w+\s*=|javascript:|data:text\/html)/i.test(value);

const manifestBodySchema = z.object({
    driverName: z.string().trim().min(1).refine(noUnsafeHtml, "Driver name contains unsupported HTML or script content"),
    driverIdNumber: z.string().trim().min(1).refine(noUnsafeHtml, "Driver ID contains unsupported HTML or script content"),
    vehicleRegistration: z.string().trim().min(1).refine(noUnsafeHtml, "Vehicle registration contains unsupported HTML or script content"),
    routeDescription: z.string().trim().min(1).refine(noUnsafeHtml, "Route description contains unsupported HTML or script content"),
    expectedDeliveryAt: z.string().datetime(),
});

export function createManifestRouter(
    manifestService = new ManifestService(),
    contractService = new ContractService(),
) {
    const router = Router({ mergeParams: true });

    // GET /trades/:id/manifest
    router.get("/", authMiddleware, validateRequest({ params: tradeIdParamSchema }), async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    });

    // POST /trades/:id/manifest
    router.post("/", authMiddleware, validateRequest({ params: tradeIdParamSchema, body: manifestBodySchema }), async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    });

    return router;
}
