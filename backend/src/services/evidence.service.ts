import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { IPFSService } from "./ipfs.service";

export class EvidenceAccessDeniedError extends Error {
    status = 403;
    constructor() {
        super("Access denied: you are not a party to this trade");
        this.name = "EvidenceAccessDeniedError";
    }
}

export class EvidenceTradeNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Trade not found");
        this.name = "EvidenceTradeNotFoundError";
    }
}

type EvidenceDatabase = {
    trade: Pick<PrismaClient["trade"], "findUnique">;
    tradeEvidence: Pick<PrismaClient["tradeEvidence"], "findMany">;
};

export class EvidenceService {
    private ipfs: IPFSService;

    constructor(
        private readonly prisma: EvidenceDatabase = defaultPrisma as unknown as EvidenceDatabase,
        ipfs?: IPFSService,
    ) {
        this.ipfs = ipfs ?? new IPFSService();
    }

    /** Return all evidence records for a trade. Caller must be buyer or seller. */
    async getEvidenceByTradeId(tradeId: string, callerAddress: string) {
        const trade = await this.prisma.trade.findUnique({
            where: { tradeId },
        });

        if (!trade) throw new EvidenceTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        if (
            trade.buyerAddress.toLowerCase() !== caller &&
            trade.sellerAddress.toLowerCase() !== caller
        ) {
            throw new EvidenceAccessDeniedError();
        }

        const records = await this.prisma.tradeEvidence.findMany({
            where: { tradeId },
            orderBy: { createdAt: "asc" },
        });

        return records.map((r) => ({
            id: r.id,
            cid: r.cid,
            filename: r.filename,
            mimeType: r.mimeType,
            uploadedBy: r.uploadedBy,
            url: this.ipfs.getFileUrl(r.cid),
            createdAt: r.createdAt,
        }));
    }

    /**
     * Proxy-stream a file from the IPFS gateway with optional Range support.
     * Returns an axios response stream so the route can pipe it.
     */
    async streamFromIPFS(cid: string, range?: string) {
        const gateway = process.env.IPFS_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
        const url = `${gateway.replace(/\/$/, "")}/${cid}`;

        const headers: Record<string, string> = {};
        if (range) headers["Range"] = range;

        const response = await axios.get(url, {
            responseType: "stream",
            headers,
            validateStatus: (s) => s < 500,
        });

        return response;
    }
}
