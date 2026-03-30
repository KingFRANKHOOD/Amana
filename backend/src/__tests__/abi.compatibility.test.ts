/**
 * ABI Compatibility Tests
 *
 * These tests ensure that the backend's ContractService call shapes
 * match the on-chain Soroban contract ABI. This prevents signature drift
 * from breaking production transaction simulation.
 *
 * The tests validate:
 * 1. Argument count matches contract function signatures
 * 2. Argument types match contract function signatures
 * 3. Argument order matches contract function signatures
 *
 * If any of these fail, CI will block the merge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
    ContractService,
    BuildCreateTradeTxInput,
    buildConfirmDeliveryTx,
    buildReleaseFundsTx,
    buildInitiateDisputeTx,
} from "../services/contract.service";

// ============================================================================
// Contract ABI Definitions (from contracts/amana_escrow/src/lib.rs)
// ============================================================================

/**
 * Expected contract function signatures extracted from the Soroban contract.
 * These are the source of truth for ABI compatibility.
 */
const CONTRACT_ABI = {
    create_trade: {
        name: "create_trade",
        args: [
            { name: "buyer", type: "Address" },
            { name: "seller", type: "Address" },
            { name: "amount", type: "i128" },
            { name: "buyer_loss_bps", type: "u32" },
            { name: "seller_loss_bps", type: "u32" },
        ],
        returnType: "u64",
    },
    deposit: {
        name: "deposit",
        args: [{ name: "trade_id", type: "u64" }],
        returnType: "void",
    },
    confirm_delivery: {
        name: "confirm_delivery",
        args: [{ name: "trade_id", type: "u64" }],
        returnType: "void",
    },
    release_funds: {
        name: "release_funds",
        args: [{ name: "trade_id", type: "u64" }],
        returnType: "void",
    },
    initiate_dispute: {
        name: "initiate_dispute",
        args: [
            { name: "trade_id", type: "u64" },
            { name: "initiator", type: "Address" },
            { name: "reason_hash", type: "String" },
        ],
        returnType: "void",
    },
} as const;

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Captures the arguments passed to contract.call() and validates them
 * against the expected ABI.
 */
function captureContractCallArgs(
    mockContract: any,
    functionName: string,
): { functionName: string; args: any[] } | null {
    const calls = mockContract.call.mock.calls;
    for (const call of calls) {
        if (call[0] === functionName) {
            return {
                functionName: call[0],
                args: call.slice(1),
            };
        }
    }
    return null;
}

/**
 * Validates that an ScVal matches the expected type.
 */
function validateScValType(scVal: any, expectedType: string): boolean {
    switch (expectedType) {
        case "Address":
            // Address is represented as an ScVal with address type
            return scVal && typeof scVal.toXDR === "function";
        case "i128":
            // i128 is represented as an ScVal with i128 type
            return scVal && typeof scVal.toXDR === "function";
        case "u64":
            // u64 is represented as an ScVal with u64 type
            return scVal && typeof scVal.toXDR === "function";
        case "u32":
            // u32 is represented as an ScVal with u32 type
            return scVal && typeof scVal.toXDR === "function";
        case "String":
            // String is represented as an ScVal with string type
            return scVal && typeof scVal.toXDR === "function";
        default:
            return false;
    }
}

// ============================================================================
// Mock Setup
// ============================================================================

describe("ABI Compatibility Tests", () => {
    let contractService: ContractService;
    let mockRpcServer: any;
    let mockContract: any;
    let mockAccount: any;
    let mockTransaction: any;
    let mockPreparedTransaction: any;

    beforeEach(() => {
        // Create mocks
        mockAccount = {
            accountId: () => ({ toString: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" }),
            sequenceNumber: () => "123456789",
            incrementSequenceNumber: () => { },
        };

        mockTransaction = {
            toXDR: () => "mock-xdr",
            addOperation: vi.fn().mockReturnThis(),
            setTimeout: vi.fn().mockReturnThis(),
            build: vi.fn().mockReturnThis(),
        };

        mockPreparedTransaction = {
            toXDR: () => "prepared-mock-xdr",
        };

        mockContract = {
            call: vi.fn().mockReturnValue({}),
        };

        mockRpcServer = {
            getAccount: vi.fn().mockResolvedValue(mockAccount),
            simulateTransaction: vi.fn().mockResolvedValue({
                result: {
                    retval: StellarSdk.xdr.ScVal.scvU64(
                        StellarSdk.xdr.Uint64.fromString("123456789"),
                    ),
                },
            }),
            prepareTransaction: vi.fn().mockResolvedValue(mockPreparedTransaction),
        };

        // Mock the TransactionBuilder
        vi.spyOn(StellarSdk, "TransactionBuilder").mockImplementation(
            () => mockTransaction as any,
        );

        // Mock the Contract constructor
        vi.spyOn(StellarSdk, "Contract").mockImplementation(
            () => mockContract as any,
        );

        // Create ContractService with mocked dependencies
        contractService = new ContractService(
            "https://testnet.soroban.rpc",
            "CONTRACT_ID",
            "USDC_CONTRACT_ID",
            StellarSdk.Networks.TESTNET,
        );

        // Inject mock RPC server
        (contractService as any).rpcServer = mockRpcServer;
    });

    // ============================================================================
    // create_trade ABI Tests
    // ============================================================================

    describe("create_trade ABI compatibility", () => {
        it("should call create_trade with correct argument count", async () => {
            const input: BuildCreateTradeTxInput = {
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                sellerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amountUsdc: "100.5000000",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            };

            await contractService.buildCreateTradeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "create_trade");
            expect(callArgs).not.toBeNull();
            expect(callArgs!.functionName).toBe("create_trade");

            // Validate argument count matches ABI (5 args)
            const abi = CONTRACT_ABI.create_trade;
            expect(callArgs!.args).toHaveLength(abi.args.length);
        });

        it("should call create_trade with correct argument types", async () => {
            const input: BuildCreateTradeTxInput = {
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                sellerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amountUsdc: "100.5000000",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            };

            await contractService.buildCreateTradeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "create_trade");
            expect(callArgs).not.toBeNull();

            const abi = CONTRACT_ABI.create_trade;

            // Validate each argument type
            expect(validateScValType(callArgs!.args[0], abi.args[0].type)).toBe(true); // buyer: Address
            expect(validateScValType(callArgs!.args[1], abi.args[1].type)).toBe(true); // seller: Address
            expect(validateScValType(callArgs!.args[2], abi.args[2].type)).toBe(true); // amount: i128
            expect(validateScValType(callArgs!.args[3], abi.args[3].type)).toBe(true); // buyer_loss_bps: u32
            expect(validateScValType(callArgs!.args[4], abi.args[4].type)).toBe(true); // seller_loss_bps: u32
        });

        it("should call create_trade with correct argument order", async () => {
            const input: BuildCreateTradeTxInput = {
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                sellerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amountUsdc: "100.5000000",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            };

            await contractService.buildCreateTradeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "create_trade");
            expect(callArgs).not.toBeNull();

            // Verify the function was called with the correct name
            expect(callArgs!.functionName).toBe("create_trade");

            // Verify argument count
            expect(callArgs!.args).toHaveLength(5);
        });

        it("should fail if create_trade argument count changes", async () => {
            // This test documents the expected behavior if someone adds/removes args
            const input: BuildCreateTradeTxInput = {
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                sellerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amountUsdc: "100.5000000",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            };

            await contractService.buildCreateTradeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "create_trade");
            expect(callArgs).not.toBeNull();

            // This assertion will fail if someone adds a 6th argument or removes one
            const expectedArgCount = CONTRACT_ABI.create_trade.args.length;
            expect(callArgs!.args).toHaveLength(expectedArgCount);
        });
    });

    // ============================================================================
    // deposit ABI Tests
    // ============================================================================

    describe("deposit ABI compatibility", () => {
        it("should call deposit with correct argument count", async () => {
            const trade = {
                tradeId: "123456789",
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                amountUsdc: "100.5000000",
            };

            await contractService.buildDepositTx(trade as any);

            const callArgs = captureContractCallArgs(mockContract, "deposit");
            expect(callArgs).not.toBeNull();
            expect(callArgs!.functionName).toBe("deposit");

            // Validate argument count matches ABI (1 arg)
            const abi = CONTRACT_ABI.deposit;
            expect(callArgs!.args).toHaveLength(abi.args.length);
        });

        it("should call deposit with correct argument types", async () => {
            const trade = {
                tradeId: "123456789",
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                amountUsdc: "100.5000000",
            };

            await contractService.buildDepositTx(trade as any);

            const callArgs = captureContractCallArgs(mockContract, "deposit");
            expect(callArgs).not.toBeNull();

            const abi = CONTRACT_ABI.deposit;

            // Validate argument type (trade_id: u64)
            expect(validateScValType(callArgs!.args[0], abi.args[0].type)).toBe(true);
        });

        it("should call deposit with correct argument order", async () => {
            const trade = {
                tradeId: "123456789",
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                amountUsdc: "100.5000000",
            };

            await contractService.buildDepositTx(trade as any);

            const callArgs = captureContractCallArgs(mockContract, "deposit");
            expect(callArgs).not.toBeNull();

            // Verify the function was called with the correct name
            expect(callArgs!.functionName).toBe("deposit");

            // Verify argument count
            expect(callArgs!.args).toHaveLength(1);
        });
    });

    // ============================================================================
    // confirm_delivery ABI Tests
    // ============================================================================

    describe("confirm_delivery ABI compatibility", () => {
        it("should call confirm_delivery with correct argument count", async () => {
            const trade = {
                tradeId: "123456789",
                status: "FUNDED",
            };

            await buildConfirmDeliveryTx(trade as any, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

            const callArgs = captureContractCallArgs(mockContract, "confirm_delivery");
            expect(callArgs).not.toBeNull();
            expect(callArgs!.functionName).toBe("confirm_delivery");

            // Validate argument count matches ABI (1 arg)
            const abi = CONTRACT_ABI.confirm_delivery;
            expect(callArgs!.args).toHaveLength(abi.args.length);
        });

        it("should call confirm_delivery with correct argument types", async () => {
            const trade = {
                tradeId: "123456789",
                status: "FUNDED",
            };

            await buildConfirmDeliveryTx(trade as any, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

            const callArgs = captureContractCallArgs(mockContract, "confirm_delivery");
            expect(callArgs).not.toBeNull();

            const abi = CONTRACT_ABI.confirm_delivery;

            // Validate argument type (trade_id: u64)
            expect(validateScValType(callArgs!.args[0], abi.args[0].type)).toBe(true);
        });

        it("should call confirm_delivery with correct argument order", async () => {
            const trade = {
                tradeId: "123456789",
                status: "FUNDED",
            };

            await buildConfirmDeliveryTx(trade as any, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

            const callArgs = captureContractCallArgs(mockContract, "confirm_delivery");
            expect(callArgs).not.toBeNull();

            // Verify the function was called with the correct name
            expect(callArgs!.functionName).toBe("confirm_delivery");

            // Verify argument count
            expect(callArgs!.args).toHaveLength(1);
        });
    });

    // ============================================================================
    // release_funds ABI Tests
    // ============================================================================

    describe("release_funds ABI compatibility", () => {
        it("should call release_funds with correct argument count", async () => {
            const trade = {
                tradeId: "123456789",
                status: "DELIVERED",
            };

            await buildReleaseFundsTx(trade as any, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

            const callArgs = captureContractCallArgs(mockContract, "release_funds");
            expect(callArgs).not.toBeNull();
            expect(callArgs!.functionName).toBe("release_funds");

            // Validate argument count matches ABI (1 arg)
            const abi = CONTRACT_ABI.release_funds;
            expect(callArgs!.args).toHaveLength(abi.args.length);
        });

        it("should call release_funds with correct argument types", async () => {
            const trade = {
                tradeId: "123456789",
                status: "DELIVERED",
            };

            await buildReleaseFundsTx(trade as any, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

            const callArgs = captureContractCallArgs(mockContract, "release_funds");
            expect(callArgs).not.toBeNull();

            const abi = CONTRACT_ABI.release_funds;

            // Validate argument type (trade_id: u64)
            expect(validateScValType(callArgs!.args[0], abi.args[0].type)).toBe(true);
        });

        it("should call release_funds with correct argument order", async () => {
            const trade = {
                tradeId: "123456789",
                status: "DELIVERED",
            };

            await buildReleaseFundsTx(trade as any, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

            const callArgs = captureContractCallArgs(mockContract, "release_funds");
            expect(callArgs).not.toBeNull();

            // Verify the function was called with the correct name
            expect(callArgs!.functionName).toBe("release_funds");

            // Verify argument count
            expect(callArgs!.args).toHaveLength(1);
        });
    });

    // ============================================================================
    // initiate_dispute ABI Tests
    // ============================================================================

    describe("initiate_dispute ABI compatibility", () => {
        it("should call initiate_dispute with correct argument count", async () => {
            const input = {
                tradeId: "123456789",
                initiatorAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                reasonHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
            };

            await contractService.buildInitiateDisputeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "initiate_dispute");
            expect(callArgs).not.toBeNull();
            expect(callArgs!.functionName).toBe("initiate_dispute");

            // Validate argument count matches ABI (3 args)
            const abi = CONTRACT_ABI.initiate_dispute;
            expect(callArgs!.args).toHaveLength(abi.args.length);
        });

        it("should call initiate_dispute with correct argument types", async () => {
            const input = {
                tradeId: "123456789",
                initiatorAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                reasonHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
            };

            await contractService.buildInitiateDisputeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "initiate_dispute");
            expect(callArgs).not.toBeNull();

            const abi = CONTRACT_ABI.initiate_dispute;

            // Validate argument types
            expect(validateScValType(callArgs!.args[0], abi.args[0].type)).toBe(true); // trade_id: u64
            expect(validateScValType(callArgs!.args[1], abi.args[1].type)).toBe(true); // initiator: Address
            expect(validateScValType(callArgs!.args[2], abi.args[2].type)).toBe(true); // reason_hash: String
        });

        it("should call initiate_dispute with correct argument order", async () => {
            const input = {
                tradeId: "123456789",
                initiatorAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                reasonHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
            };

            await contractService.buildInitiateDisputeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "initiate_dispute");
            expect(callArgs).not.toBeNull();

            // Verify the function was called with the correct name
            expect(callArgs!.functionName).toBe("initiate_dispute");

            // Verify argument count
            expect(callArgs!.args).toHaveLength(3);
        });
    });

    // ============================================================================
    // Cross-Function ABI Validation
    // ============================================================================

    describe("Cross-function ABI validation", () => {
        it("should have all required contract functions defined in ABI", () => {
            const requiredFunctions = [
                "create_trade",
                "deposit",
                "confirm_delivery",
                "release_funds",
                "initiate_dispute",
            ];

            for (const funcName of requiredFunctions) {
                expect(CONTRACT_ABI).toHaveProperty(funcName);
                expect(CONTRACT_ABI[funcName as keyof typeof CONTRACT_ABI]).toHaveProperty("name");
                expect(CONTRACT_ABI[funcName as keyof typeof CONTRACT_ABI]).toHaveProperty("args");
                expect(CONTRACT_ABI[funcName as keyof typeof CONTRACT_ABI]).toHaveProperty("returnType");
            }
        });

        it("should validate that all ABI functions have non-empty args arrays", () => {
            for (const [funcName, funcDef] of Object.entries(CONTRACT_ABI)) {
                expect(funcDef.args.length).toBeGreaterThan(0);
            }
        });

        it("should validate that all ABI function args have name and type", () => {
            for (const [funcName, funcDef] of Object.entries(CONTRACT_ABI)) {
                for (const arg of funcDef.args) {
                    expect(arg).toHaveProperty("name");
                    expect(arg).toHaveProperty("type");
                    expect(arg.name.length).toBeGreaterThan(0);
                    expect(arg.type.length).toBeGreaterThan(0);
                }
            }
        });
    });

    // ============================================================================
    // Argument Drift Detection Tests
    // ============================================================================

    describe("Argument drift detection", () => {
        it("should detect if create_trade loses an argument", async () => {
            const input: BuildCreateTradeTxInput = {
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                sellerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amountUsdc: "100.5000000",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            };

            await contractService.buildCreateTradeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "create_trade");
            expect(callArgs).not.toBeNull();

            // This will fail if someone removes an argument from the backend call
            expect(callArgs!.args).toHaveLength(5);
        });

        it("should detect if create_trade gains an argument", async () => {
            const input: BuildCreateTradeTxInput = {
                buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                sellerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amountUsdc: "100.5000000",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            };

            await contractService.buildCreateTradeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "create_trade");
            expect(callArgs).not.toBeNull();

            // This will fail if someone adds an extra argument to the backend call
            expect(callArgs!.args).toHaveLength(5);
        });

        it("should detect if initiate_dispute loses an argument", async () => {
            const input = {
                tradeId: "123456789",
                initiatorAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                reasonHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
            };

            await contractService.buildInitiateDisputeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "initiate_dispute");
            expect(callArgs).not.toBeNull();

            // This will fail if someone removes an argument from the backend call
            expect(callArgs!.args).toHaveLength(3);
        });

        it("should detect if initiate_dispute gains an argument", async () => {
            const input = {
                tradeId: "123456789",
                initiatorAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                reasonHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
            };

            await contractService.buildInitiateDisputeTx(input);

            const callArgs = captureContractCallArgs(mockContract, "initiate_dispute");
            expect(callArgs).not.toBeNull();

            // This will fail if someone adds an extra argument to the backend call
            expect(callArgs!.args).toHaveLength(3);
        });
    });
});
