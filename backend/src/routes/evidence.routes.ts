import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import {
    EvidenceService,
    EvidenceAccessDeniedError,
    EvidenceTradeNotFoundError,
} from "../services/evidence.service";

export function createEvidenceRouter(evidenceService = new EvidenceService()) {
    const router = Router({ mergeParams: true });

    // GET /trades/:id/evidence — list all evidence for a trade
    router.get("/trades/:id/evidence", authMiddleware, async (req: AuthRequest, res: Response) => {
        const callerAddress = req.user?.walletAddress;
        if (!callerAddress) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        try {
            const records = await evidenceService.getEvidenceByTradeId(
                req.params.id as string,
                callerAddress,
            );
            res.status(200).json({ evidence: records });
        } catch (err) {
            if (err instanceof EvidenceTradeNotFoundError) {
                res.status(404).json({ error: err.message });
                return;
            }
            if (err instanceof EvidenceAccessDeniedError) {
                res.status(403).json({ error: err.message });
                return;
            }
            console.error("[EvidenceRoute] Error:", err);
            res.status(500).json({ error: "Failed to retrieve evidence" });
        }
    });

    // GET /evidence/:cid/stream — proxy IPFS with range support
    router.get("/evidence/:cid/stream", authMiddleware, async (req: AuthRequest, res: Response) => {
        const callerAddress = req.user?.walletAddress;
        if (!callerAddress) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const cid = req.params.cid as string;
        const range = req.headers["range"] as string | undefined;

        try {
            const upstream = await evidenceService.streamFromIPFS(cid, range);

            // Forward relevant headers
            const forwardHeaders = [
                "content-type",
                "content-length",
                "content-range",
                "accept-ranges",
            ];
            for (const h of forwardHeaders) {
                const val = upstream.headers[h];
                if (val) res.setHeader(h, val);
            }

            const status = range ? 206 : upstream.status;
            res.status(status);
            upstream.data.pipe(res);
        } catch (err) {
            console.error("[EvidenceRoute] Stream error:", err);
            res.status(502).json({ error: "Failed to stream from IPFS gateway" });
        }
    });

    return router;
}

export const evidenceRoutes = createEvidenceRouter();
