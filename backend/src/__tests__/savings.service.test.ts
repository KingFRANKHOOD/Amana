import { describe, it, expect, beforeEach, vi } from "vitest";
import { SavingsService } from "../services/savings.service";
import { PrismaClient } from "@prisma/client";

describe("SavingsService", () => {
    let savingsService: SavingsService;
    let mockPrisma: any;

    beforeEach(() => {
        mockPrisma = {
            user: {
                findUnique: vi.fn(),
            },
            goal: {
                findMany: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
            },
            vault: {
                create: vi.fn(),
                update: vi.fn(),
                findUnique: vi.fn(),
            },
        };

        savingsService = new SavingsService(mockPrisma);
    });

    describe("getGoalsAnalytics", () => {
        it("should return goal analytics for a user", async () => {
            const walletAddress = "GUSER123";
            const userId = 1;

            const mockUser = {
                id: userId,
                walletAddress: walletAddress.toLowerCase(),
                displayName: "Test User",
                createdAt: new Date(),
                updatedAt: new Date(),
                vaults: [
                    {
                        id: 1,
                        vaultId: "vault-1",
                        ownerAddress: walletAddress.toLowerCase(),
                        balanceUsdc: "5000000000",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        goals: [],
                    },
                ],
            };

            const now = new Date();
            const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

            const mockGoals = [
                {
                    id: 1,
                    goalId: "goal-1",
                    vaultId: "vault-1",
                    userId,
                    targetAmountUsdc: "10000000000", // 1000 USDC
                    currentAmountUsdc: "7400000000", // 740 USDC (74%)
                    deadline,
                    status: "ACTIVE" as const,
                    createdAt: now,
                    updatedAt: now,
                    vault: mockUser.vaults[0],
                },
            ];

            mockPrisma.user.findUnique.mockResolvedValue(mockUser);
            mockPrisma.goal.findMany.mockResolvedValue(mockGoals);

            const result = await savingsService.getGoalsAnalytics(walletAddress);

            expect(result.walletAddress).toBe(walletAddress.toLowerCase());
            expect(result.totalGoals).toBe(1);
            expect(result.activeGoals).toBe(1);
            expect(result.goals[0].percentageComplete).toBe(74);
            expect(result.goals[0].isOnTrack).toBe(true);
            expect(result.overallProgressPercentage).toBe(74);
        });

        it("should throw error if user not found", async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);

            await expect(
                savingsService.getGoalsAnalytics("NONEXISTENT")
            ).rejects.toThrow("User not found");
        });
    });

    describe("createVault", () => {
        it("should create a vault for a user", async () => {
            const walletAddress = "GUSER123";
            const vaultId = "vault-1";

            mockPrisma.user.findUnique.mockResolvedValue({
                id: 1,
                walletAddress: walletAddress.toLowerCase(),
            });

            mockPrisma.vault.create.mockResolvedValue({
                id: 1,
                vaultId,
                ownerAddress: walletAddress.toLowerCase(),
                balanceUsdc: "0",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await savingsService.createVault(walletAddress, vaultId);

            expect(result.vaultId).toBe(vaultId);
            expect(result.ownerAddress).toBe(walletAddress.toLowerCase());
            expect(mockPrisma.vault.create).toHaveBeenCalled();
        });

        it("should throw error if user not found", async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);

            await expect(
                savingsService.createVault("NONEXISTENT", "vault-1")
            ).rejects.toThrow("User not found");
        });
    });

    describe("createGoal", () => {
        it("should create a goal linked to a vault", async () => {
            const walletAddress = "GUSER123";
            const goalId = "goal-1";
            const vaultId = "vault-1";
            const targetAmount = "10000000000";
            const deadline = new Date();

            mockPrisma.user.findUnique.mockResolvedValue({
                id: 1,
                walletAddress: walletAddress.toLowerCase(),
            });

            mockPrisma.vault.findUnique.mockResolvedValue({
                id: 1,
                vaultId,
                ownerAddress: walletAddress.toLowerCase(),
            });

            mockPrisma.goal.create.mockResolvedValue({
                id: 1,
                goalId,
                vaultId,
                userId: 1,
                targetAmountUsdc: targetAmount,
                currentAmountUsdc: "0",
                deadline,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await savingsService.createGoal(
                walletAddress,
                goalId,
                vaultId,
                targetAmount,
                deadline
            );

            expect(result.goalId).toBe(goalId);
            expect(result.targetAmountUsdc).toBe(targetAmount);
            expect(mockPrisma.goal.create).toHaveBeenCalled();
        });
    });

    describe("updateGoalProgress", () => {
        it("should update goal progress", async () => {
            const goalId = "goal-1";
            const newAmount = "5000000000";

            mockPrisma.goal.update.mockResolvedValue({
                id: 1,
                goalId,
                currentAmountUsdc: newAmount,
            });

            const result = await savingsService.updateGoalProgress(goalId, newAmount);

            expect(result.currentAmountUsdc).toBe(newAmount);
            expect(mockPrisma.goal.update).toHaveBeenCalledWith({
                where: { goalId },
                data: { currentAmountUsdc: newAmount },
            });
        });
    });

    describe("completeGoal", () => {
        it("should mark goal as completed", async () => {
            const goalId = "goal-1";

            mockPrisma.goal.update.mockResolvedValue({
                id: 1,
                goalId,
                status: "COMPLETED",
            });

            const result = await savingsService.completeGoal(goalId);

            expect(result.status).toBe("COMPLETED");
            expect(mockPrisma.goal.update).toHaveBeenCalledWith({
                where: { goalId },
                data: { status: "COMPLETED" },
            });
        });
    });

    describe("cancelGoal", () => {
        it("should cancel a goal", async () => {
            const goalId = "goal-1";

            mockPrisma.goal.update.mockResolvedValue({
                id: 1,
                goalId,
                status: "CANCELLED",
            });

            const result = await savingsService.cancelGoal(goalId);

            expect(result.status).toBe("CANCELLED");
            expect(mockPrisma.goal.update).toHaveBeenCalledWith({
                where: { goalId },
                data: { status: "CANCELLED" },
            });
        });
    });
});
