import { Router, Response } from "express";
import { Parser } from "json2csv";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import {
    AuditTrailService,
    AuditTrailAccessDeniedError,
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
                res.status(200).send(csv);
                return;
            }

            res.status(200).json({ events });
        } catch (err) {
            if (err instanceof AuditTrailTradeNotFoundError) {
                res.status(404).json({ error: err.message });
                return;
            }
            if (err instanceof AuditTrailAccessDeniedError) {
                res.status(403).json({ error: err.message });
                return;
            }
            appLogger.error({ err }, "[AuditTrailRoute] Error");
            res.status(500).json({ error: "Failed to retrieve trade history" });
        }
    });

    return router;
}
