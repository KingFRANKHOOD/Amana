import crypto from "crypto";
import { PrismaClient, TradeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";

export interface SubmitManifestInput {
    tradeId: string;
    callerAddress: string;
    driverName: string;
    driverIdNumber: string;
    vehicleRegistration: string;
    routeDescription: string;
    expectedDeliveryAt: string;
}

export class ManifestForbiddenError extends Error {
    status = 403;
    constructor() {
        super("Only the seller may submit a delivery manifest");
        this.name = "ManifestForbiddenError";
    }
}

export class ManifestAccessDeniedError extends Error {
    status = 403;
    constructor() {
        super("Access denied: you are not allowed to view this manifest");
        this.name = "ManifestAccessDeniedError";
    }
}

export class ManifestConflictError extends Error {
    status = 409;
    constructor() {
        super("A manifest has already been submitted for this trade");
        this.name = "ManifestConflictError";
    }
}

export class ManifestTradeStatusError extends Error {
    status = 400;
    constructor(status: string) {
        super(`Trade must be in FUNDED status to submit a manifest (current: ${status})`);
        this.name = "ManifestTradeStatusError";
    }
}

export class ManifestTradeNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Trade not found");
        this.name = "ManifestTradeNotFoundError";
    }
}

export class ManifestNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Manifest not found");
        this.name = "ManifestNotFoundError";
    }
}

function sha256(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

type ManifestDatabase = {
    trade: Pick<PrismaClient["trade"], "findUnique">;
    deliveryManifest: Pick<PrismaClient["deliveryManifest"], "findUnique" | "create">;
};

function isUniqueConstraintError(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002",
    );
}

function parseMediatorAllowlist(): Set<string> {
    const raw = process.env.ADMIN_STELLAR_PUBKEYS ?? "";
    return new Set(
        raw
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
    );
}

function maskDriverName(driverName: string): string {
    const initial = (driverName.trim()[0] ?? "D").toUpperCase();
    return `${initial}****`;
}

function maskDriverIdNumber(): string {
    return "ID-****";
}

export class ManifestService {
    constructor(private readonly prisma: ManifestDatabase = defaultPrisma as unknown as ManifestDatabase) { }

    async submitManifest(input: SubmitManifestInput) {
        const trade = await this.prisma.trade.findUnique({
            where: { tradeId: input.tradeId },
        });

        if (!trade) throw new ManifestTradeNotFoundError();

        // Access: caller must be the seller
        if (trade.sellerAddress.toLowerCase() !== input.callerAddress.toLowerCase()) {
            throw new ManifestForbiddenError();
        }

        // Trade must be FUNDED
        if (trade.status !== TradeStatus.FUNDED) {
            throw new ManifestTradeStatusError(trade.status);
        }

        // Check for existing manifest
        const existing = await this.prisma.deliveryManifest.findUnique({
            where: { tradeId: input.tradeId },
        });
        if (existing) throw new ManifestConflictError();

        const driverNameHash = sha256(input.driverName);
        const driverIdHash = sha256(input.driverIdNumber);

        let manifest;
        try {
            manifest = await this.prisma.deliveryManifest.create({
                data: {
                    tradeId: input.tradeId,
                    driverName: input.driverName,
                    driverIdNumber: input.driverIdNumber,
                    vehicleRegistration: input.vehicleRegistration,
                    routeDescription: input.routeDescription,
                    expectedDeliveryAt: new Date(input.expectedDeliveryAt),
                    driverNameHash,
                    driverIdHash,
                },
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ManifestConflictError();
            }
            throw error;
        }

        return { manifestId: manifest.id, driverNameHash, driverIdHash };
    }

    async getManifestByTradeId(tradeId: string, callerAddress: string) {
        const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
        if (!trade) throw new ManifestTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        const isBuyer = trade.buyerAddress.toLowerCase() === caller;
        const isSeller = trade.sellerAddress.toLowerCase() === caller;
        const isMediator = parseMediatorAllowlist().has(caller);

        if (!isBuyer && !isSeller && !isMediator) {
            throw new ManifestAccessDeniedError();
        }

        const manifest = await this.prisma.deliveryManifest.findUnique({
            where: { tradeId },
        });
        if (!manifest) throw new ManifestNotFoundError();

        if (isBuyer) {
            return {
                tradeId,
                roleView: "buyer" as const,
                driverName: maskDriverName(manifest.driverName),
                driverIdNumber: maskDriverIdNumber(),
                vehicleRegistration: manifest.vehicleRegistration,
                routeDescription: manifest.routeDescription,
                expectedDeliveryAt: manifest.expectedDeliveryAt,
                createdAt: manifest.createdAt,
            };
        }

        if (isMediator) {
            return {
                tradeId,
                roleView: "mediator" as const,
                driverNameHash: manifest.driverNameHash,
                driverIdHash: manifest.driverIdHash,
                vehicleRegistration: manifest.vehicleRegistration,
                routeDescription: manifest.routeDescription,
                expectedDeliveryAt: manifest.expectedDeliveryAt,
                createdAt: manifest.createdAt,
            };
        }

        return {
            tradeId,
            roleView: "seller" as const,
            driverName: manifest.driverName,
            driverIdNumber: manifest.driverIdNumber,
            driverNameHash: manifest.driverNameHash,
            driverIdHash: manifest.driverIdHash,
            vehicleRegistration: manifest.vehicleRegistration,
            routeDescription: manifest.routeDescription,
            expectedDeliveryAt: manifest.expectedDeliveryAt,
            createdAt: manifest.createdAt,
        };
    }
}
