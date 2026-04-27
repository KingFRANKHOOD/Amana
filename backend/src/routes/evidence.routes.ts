import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import {
    EvidenceService,
    EvidenceAccessDeniedError,
    EvidenceTradeNotFoundError,
    EvidenceScanError,
} from "../services/evidence.service";
import { appLogger } from "../middleware/logger";
import { validateRequest } from "../middleware/validateRequest";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { 
    uploadEvidenceSchema, 
    streamEvidenceParamSchema 
} from "../schemas/evidence.schemas";
import { tradeIdParamSchema } from "../schemas/trade.schemas";

const ALLOWED_MIME_TYPES = ["video/mp4", "video/webm"];
const MAX_FILE_SIZE = parseInt(process.env.EVIDENCE_MAX_BYTES || "52428800", 10);

const videoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(null, false);
        }
    },
});

function handleVideoMulter(req: Request, res: Response, next: NextFunction) {
    videoUpload.single("file")(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            res.status(413).json({ error: "File exceeds the 50MB size limit" });
            return;
        }
        if (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : "Upload error" });
            return;
        }
        next();
    });
}

export function createEvidenceRouter(evidenceService = new EvidenceService()) {
    const router = Router({ mergeParams: true });

    // GET /trades/:id/evidence — list all evidence for a trade
    router.get(
        "/trades/:id/evidence", 
        authMiddleware, 
        validateRequest({ params: tradeIdParamSchema }),
        async (req: AuthRequest, res: Response) => {
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
                throw err;
            }
        }
    );

    // GET /evidence/:cid/stream — proxy IPFS with range support
    router.get(
        "/evidence/:cid/stream", 
        authMiddleware, 
        validateRequest({ params: streamEvidenceParamSchema }),
        async (req: AuthRequest, res: Response) => {
            const callerAddress = req.user?.walletAddress;
            if (!callerAddress) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }

            const cid = req.params.cid as string;
            const range = req.headers["range"] as string | undefined;

            try {
                const upstream = await evidenceService.streamFromIPFS(cid, range);

                // Always advertise range support so clients know they can seek
                res.setHeader("accept-ranges", "bytes");

                // Forward relevant headers from the upstream gateway
                const forwardHeaders = ["content-type", "content-length", "content-range"];
                for (const h of forwardHeaders) {
                    const val = upstream.headers[h];
                    if (val) res.setHeader(h, val as string);
                }

                const status = range ? 206 : upstream.status;
                res.status(status);
                upstream.data.pipe(res);
            } catch (err) {
                appLogger.error({ err }, "[EvidenceRoute] Stream error");
                res.status(502).json({ error: "Failed to stream from IPFS gateway" });
            }
        }
    );

    // POST /evidence/video — upload a video file (MP4 / WebM, ≤ 50 MB) to IPFS
    router.post(
        "/evidence/video",
        authMiddleware,
        idempotencyMiddleware,
        handleVideoMulter,
        validateRequest({ body: uploadEvidenceSchema }),
        async (req: AuthRequest, res: Response) => {
            const callerAddress = req.user?.walletAddress;
            if (!callerAddress) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }

            if (!req.file) {
                res.status(415).json({ error: "Unsupported media type — only MP4 and WebM are accepted" });
                return;
            }

            const { tradeId } = req.body;

            try {
                const result = await evidenceService.uploadVideoEvidence(tradeId, callerAddress, req.file);
                res.status(201).json(result);
            } catch (err) {
                if (err instanceof EvidenceTradeNotFoundError) {
                    res.status(404).json({ error: err.message });
                    return;
                }
                if (err instanceof EvidenceAccessDeniedError) {
                    res.status(403).json({ error: err.message });
                    return;
                }
                if (err instanceof EvidenceScanError) {
                    res.status(err.status).json({ error: err.message });
                    return;
                }
                throw err;
            }
        },
    );

    return router;
}


export const evidenceRoutes = createEvidenceRouter();
