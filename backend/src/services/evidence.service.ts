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
    tradeEvidence: Pick<PrismaClient["tradeEvidence"], "findMany" | "create">;
};

export class EvidenceService {
    private ipfs: IPFSService;
    /** In-process cache: CID → resolved gateway URL */
    private readonly urlCache = new Map<string, string>();

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
            url: this.resolveGatewayUrl(r.cid),
            createdAt: r.createdAt,
        }));
    }

    /**
     * Upload a video file to IPFS and persist the evidence record.
     * Caller must be buyer or seller of the referenced trade.
     */
    async uploadVideoEvidence(
        tradeId: string,
        callerAddress: string,
        file: Express.Multer.File,
    ) {
        const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
        if (!trade) throw new EvidenceTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        if (
            trade.buyerAddress.toLowerCase() !== caller &&
            trade.sellerAddress.toLowerCase() !== caller
        ) {
            throw new EvidenceAccessDeniedError();
        }

        const cid = await this.ipfs.uploadFile(file.buffer, file.originalname);

        const record = await this.prisma.tradeEvidence.create({
            data: {
                tradeId,
                cid,
                filename: file.originalname,
                mimeType: file.mimetype,
                uploadedBy: caller,
            },
        });

        return {
            evidenceId: record.id,
            cid,
            ipfsUrl: this.resolveGatewayUrl(cid),
        };
    }

    /**
     * Proxy-stream a file from the IPFS gateway with optional Range support.
     * Returns an axios response stream so the route can pipe it.
     */
    async streamFromIPFS(cid: string, range?: string) {
        const url = this.resolveGatewayUrl(cid);

        const headers: Record<string, string> = {};
        if (range) headers["Range"] = range;

        const response = await axios.get(url, {
            responseType: "stream",
            headers,
            validateStatus: (s) => s < 500,
        });

        return response;
    }

    /** Resolve and cache the public gateway URL for a CID. */
    private resolveGatewayUrl(cid: string): string {
        if (this.urlCache.has(cid)) {
            return this.urlCache.get(cid)!;
        }
        const url = this.ipfs.getFileUrl(cid);
        this.urlCache.set(cid, url);
        return url;
    }
}
