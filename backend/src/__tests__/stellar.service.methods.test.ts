import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the service
vi.mock("../config/stellar", () => ({
    horizonServer: {
        loadAccount: vi.fn(),
        strictReceivePaths: vi.fn(),
    },
    sorobanRpcClient: {},
    networkPassphrase: "Test SDF Network ; September 2015",
}));
vi.mock("../config/tracing", () => ({ TracingHelper: { withSpan: (_n: string, fn: Function) => fn({ setAttributes: vi.fn(), end: vi.fn() }) } }));
vi.mock("../lib/circuitBreaker", () => ({
    CircuitBreaker: vi.fn().mockImplementation(() => ({ getState: () => "CLOSED", execute: (fn: Function) => fn() })),
    withCircuitBreaker: (_fn: Function, _cb: any) => _fn(),
    getCircuitBreaker: vi.fn(),
}));
vi.mock("../lib/retry", () => ({ retryAsync: (_fn: Function) => _fn() }));
vi.mock("../lib/metrics", () => ({ classifySubmissionError: vi.fn(), recordTransactionSubmission: vi.fn() }));
vi.mock("../middleware/logger", () => ({ appLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../errors/service.errors", () => ({
    classifyStellarServiceError: (e: Error) => e,
    StellarError: class StellarError extends Error { constructor(p: any) { super(p.message); } },
}));

import { StellarService } from "../services/stellar.service";
import { horizonServer } from "../config/stellar";

describe("StellarService new methods (#732)", () => {
    let service: StellarService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new StellarService();
    });

    describe("loadAccount", () => {
        it("returns account response from Horizon", async () => {
            const mockAccount = { id: "GABC", sequence: "100" };
            vi.mocked(horizonServer.loadAccount).mockResolvedValue(mockAccount as any);

            const result = await service.loadAccount("GABC");
            expect(result).toEqual(mockAccount);
            expect(horizonServer.loadAccount).toHaveBeenCalledWith("GABC");
        });

        it("throws classified error when Horizon fails", async () => {
            vi.mocked(horizonServer.loadAccount).mockRejectedValue(new Error("Not found"));
            await expect(service.loadAccount("GINVALID")).rejects.toThrow("Not found");
        });
    });

    describe("findPaymentPath", () => {
        it("returns path records from strictReceivePaths", async () => {
            const mockPaths = { records: [{ path: [], source_amount: "1" }] };
            const callMock = vi.fn().mockResolvedValue(mockPaths);
            vi.mocked(horizonServer.strictReceivePaths).mockReturnValue({ call: callMock } as any);

            const result = await service.findPaymentPath({
                sourceAssets: [{ asset_type: "native" }],
                destinationAsset: { asset_type: "native" },
                destinationAmount: "10",
            });
            expect(result).toEqual(mockPaths.records);
        });

        it("throws classified error on Horizon failure", async () => {
            vi.mocked(horizonServer.strictReceivePaths).mockReturnValue({
                call: vi.fn().mockRejectedValue(new Error("horizon down")),
            } as any);
            await expect(service.findPaymentPath({
                sourceAssets: [],
                destinationAsset: {},
                destinationAmount: "1",
            })).rejects.toThrow("horizon down");
        });
    });

    describe("buildStrictSendOp", () => {
        it("returns a strict-send op descriptor with correct fields", () => {
            const op = service.buildStrictSendOp({
                sendAsset: "native",
                sendAmount: "10",
                destination: "GDEST",
                destAsset: "USDC",
                destMin: "9.5",
            });
            expect(op.type).toBe("pathPaymentStrictSend");
            expect(op.sendAmount).toBe("10");
            expect(op.destMin).toBe("9.5");
            expect(op.path).toEqual([]);
        });

        it("includes provided path array", () => {
            const op = service.buildStrictSendOp({
                sendAsset: "native",
                sendAmount: "5",
                destination: "GDEST",
                destAsset: "XLM",
                destMin: "4",
                path: ["USDC", "BTC"],
            });
            expect(op.path).toEqual(["USDC", "BTC"]);
        });
    });

    describe("buildStrictReceiveOp", () => {
        it("returns a strict-receive op descriptor with correct fields", () => {
            const op = service.buildStrictReceiveOp({
                sendAsset: "native",
                sendMax: "11",
                destination: "GDEST",
                destAsset: "USDC",
                destAmount: "10",
            });
            expect(op.type).toBe("pathPaymentStrictReceive");
            expect(op.destAmount).toBe("10");
            expect(op.sendMax).toBe("11");
            expect(op.path).toEqual([]);
        });
    });
});
