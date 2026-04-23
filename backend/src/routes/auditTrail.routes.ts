import { Router, Response } from "express";
import crypto from "crypto";
import { Parser } from "json2csv";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import {
    AuditTrailService,
    AuditTrailAccessDeniedError,
    AuditSigningConfigError,
    AuditTrailTradeNotFoundError,
} from "../services/auditTrail.service";
import { appLogger } from "../middleware/logger";

export function createAuditTrailRouter(auditService = new AuditTrailService()) {
    const router = Router({ mergeParams: true });

    // GET /trades/:id/history
    router.get("/:id/history", authMiddleware, async (req: AuthRequest, res: Response) => {
        const callerAddress = req.user?.walletAddress;
        if (!callerAddress) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        try {
            const events = await auditService.getTradeHistory(req.params.id as string, callerAddress);
            const format = req.query.format as string | undefined;
            const signed = req.query.signed === "true";
            const canonicalPayload = auditService.getCanonicalPayload(req.params.id as string, events);
            const integrity = signed ? auditService.signPayload(canonicalPayload) : undefined;

            if (format === "csv") {
                const parser = new Parser({
                    fields: ["eventType", "timestamp", "actor", "metadata"],
                });
                const csv = parser.parse(
                    events.map((e) => ({ ...e, metadata: JSON.stringify(e.metadata) }))
                );
                res.setHeader("Content-Type", "text/csv");
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename="trade-${req.params.id}-history.csv"`
                );
                if (!signed) {
                    res.status(200).send(csv);
                    return;
                }

                res.status(200).json({
                    format: "csv",
                    csv,
                    integrity,
                    canonicalPayload,
                });
                return;
            }

            res.status(200).json({
                format: "json",
                events,
                integrity,
                canonicalPayload: signed ? canonicalPayload : undefined,
            });
        } catch (err) {
            if (err instanceof AuditTrailTradeNotFoundError) {
                res.status(404).json({ error: err.message });
                return;
            }
            if (err instanceof AuditTrailAccessDeniedError) {
                res.status(403).json({ error: err.message });
                return;
            }
            if (err instanceof AuditSigningConfigError) {
                res.status(500).json({ error: err.message });
                return;
            }
            appLogger.error({ err }, "[AuditTrailRoute] Error");
            res.status(500).json({ error: "Failed to retrieve trade history" });
        }
    });

    // GET /trades/:id/history/verify?signature=<base64>
    router.get("/:id/history/verify", authMiddleware, async (req: AuthRequest, res: Response) => {
        const callerAddress = req.user?.walletAddress;
        const signature = req.query.signature as string | undefined;
        if (!callerAddress) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        if (!signature) {
            res.status(400).json({ error: "Missing signature query parameter" });
            return;
        }

        try {
            const events = await auditService.getTradeHistory(req.params.id as string, callerAddress);
            const canonicalPayload = auditService.getCanonicalPayload(req.params.id as string, events);
            const payloadHash = crypto
                .createHash("sha256")
                .update(Buffer.from(JSON.stringify(canonicalPayload), "utf8"))
                .digest("hex");
            const valid = auditService.verifyPayload(canonicalPayload, signature);
            res.status(200).json({
                valid,
                payloadHash,
                algorithm: "ed25519",
                keyId: process.env.AUDIT_SIGNING_KEY_ID ?? null,
            });
        } catch (err) {
            if (err instanceof AuditTrailTradeNotFoundError) {
                res.status(404).json({ error: err.message });
                return;
            }
            if (err instanceof AuditTrailAccessDeniedError) {
                res.status(403).json({ error: err.message });
                return;
            }
            if (err instanceof AuditSigningConfigError) {
                res.status(500).json({ error: err.message });
                return;
            }
            appLogger.error({ err }, "[AuditTrailRoute] Verify error");
            res.status(500).json({ error: "Failed to verify trade history signature" });
        }
    });

    return router;
}
