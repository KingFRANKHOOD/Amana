import { Prisma, PrismaClient, Goal, Vault } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import * as StellarSdk from "@stellar/stellar-sdk";
import { env } from "../config/env";

const USDC_DECIMALS = 7n;
const USDC_BASE = 10n ** USDC_DECIMALS;

interface GoalAnalytics {
    goalId: string;
    targetAmountUsdc: string;
    currentAmountUsdc: string;
    percentageComplete: number;
    daysRemaining: number;
    deadline: string;
    status: string;
    vaultBalance: string;
    isOnTrack: boolean;
}

interface GoalsAnalyticsResponse {
    walletAddress: string;
    totalGoals: number;
    activeGoals: number;
    completedGoals: number;
    totalTargetAmount: string;
    totalCurrentAmount: string;
    overallProgressPercentage: number;
    goals: GoalAnalytics[];
    timestamp: string;
}

type SavingsDatabase = Pick<PrismaClient, "goal" | "vault" | "user">;

export class SavingsService {
    constructor(private readonly prisma: SavingsDatabase = defaultPrisma) { }

    /**
     * Fetch all goals for a user and compute analytics
     * Correlates live Soroban balances with goal progression
     */
    async getGoalsAnalytics(walletAddress: string): Promise<GoalsAnalyticsResponse> {
        const normalizedAddress = walletAddress.toLowerCase();

        // Fetch user and their vaults
        const user = await this.prisma.user.findUnique({
            where: { walletAddress: normalizedAddress },
            include: {
                vaults: {
                    include: {
                        goals: {
                            where: { status: "ACTIVE" },
                        },
                    },
                },
            },
        });

        if (!user) {
            throw new Error(`User not found: ${walletAddress}`);
        }

        // Fetch all goals (active and completed) for analytics
        const allGoals = await this.prisma.goal.findMany({
            where: { userId: user.id },
            include: { vault: true },
        });

        // Compute analytics for each goal
        const goalsAnalytics: GoalAnalytics[] = allGoals.map((goal) => {
            const targetAmount = BigInt(goal.targetAmountUsdc);
            const currentAmount = BigInt(goal.currentAmountUsdc);
            const percentageComplete =
                targetAmount > 0n
                    ? Number((currentAmount * 100n) / targetAmount)
                    : 0;

            const now = new Date();
            const deadline = new Date(goal.deadline);
            const daysRemaining = Math.ceil(
                (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            // Determine if goal is on track
            // On track if: (daysRemaining / totalDays) >= (percentageComplete / 100)
            const createdDate = new Date(goal.createdAt);
            const totalDays = Math.ceil(
                (deadline.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
            );
            const expectedProgress = totalDays > 0 ? 100 - (daysRemaining / totalDays) * 100 : 100;
            const isOnTrack = percentageComplete >= expectedProgress * 0.9; // 90% threshold

            return {
                goalId: goal.goalId,
                targetAmountUsdc: goal.targetAmountUsdc,
                currentAmountUsdc: goal.currentAmountUsdc,
                percentageComplete,
                daysRemaining: Math.max(0, daysRemaining),
                deadline: deadline.toISOString(),
                status: goal.status,
                vaultBalance: goal.vault.balanceUsdc,
                isOnTrack,
            };
        });

        // Calculate aggregate metrics
        const activeGoals = goalsAnalytics.filter((g) => g.status === "ACTIVE");
        const completedGoals = goalsAnalytics.filter((g) => g.status === "COMPLETED");

        const totalTargetAmount = allGoals.reduce(
            (sum, goal) => sum + BigInt(goal.targetAmountUsdc),
            0n
        );
        const totalCurrentAmount = allGoals.reduce(
            (sum, goal) => sum + BigInt(goal.currentAmountUsdc),
            0n
        );

        const overallProgressPercentage =
            totalTargetAmount > 0n
                ? Number((totalCurrentAmount * 100n) / totalTargetAmount)
                : 0;

        return {
            walletAddress: normalizedAddress,
            totalGoals: allGoals.length,
            activeGoals: activeGoals.length,
            completedGoals: completedGoals.length,
            totalTargetAmount: totalTargetAmount.toString(),
            totalCurrentAmount: totalCurrentAmount.toString(),
            overallProgressPercentage,
            goals: goalsAnalytics,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Create a new vault for a user
     */
    async createVault(
        walletAddress: string,
        vaultId: string,
        initialBalance: string = "0"
    ): Promise<Vault> {
        const normalizedAddress = walletAddress.toLowerCase();

        // Ensure user exists
        const user = await this.prisma.user.findUnique({
            where: { walletAddress: normalizedAddress },
        });

        if (!user) {
            throw new Error(`User not found: ${walletAddress}`);
        }

        return this.prisma.vault.create({
            data: {
                vaultId,
                ownerAddress: normalizedAddress,
                balanceUsdc: initialBalance,
            },
        });
    }

    /**
     * Create a new goal linked to a vault
     */
    async createGoal(
        walletAddress: string,
        goalId: string,
        vaultId: string,
        targetAmountUsdc: string,
        deadline: Date
    ): Promise<Goal> {
        const normalizedAddress = walletAddress.toLowerCase();

        const user = await this.prisma.user.findUnique({
            where: { walletAddress: normalizedAddress },
        });

        if (!user) {
            throw new Error(`User not found: ${walletAddress}`);
        }

        const vault = await this.prisma.vault.findUnique({
            where: { vaultId },
        });

        if (!vault) {
            throw new Error(`Vault not found: ${vaultId}`);
        }

        return this.prisma.goal.create({
            data: {
                goalId,
                vaultId,
                userId: user.id,
                targetAmountUsdc,
                deadline,
            },
        });
    }

    /**
     * Update goal progress (called by event listener when deposits occur)
     */
    async updateGoalProgress(
        goalId: string,
        currentAmountUsdc: string
    ): Promise<Goal> {
        return this.prisma.goal.update({
            where: { goalId },
            data: { currentAmountUsdc },
        });
    }

    /**
     * Update vault balance (called by event listener)
     */
    async updateVaultBalance(vaultId: string, balanceUsdc: string): Promise<Vault> {
        return this.prisma.vault.update({
            where: { vaultId },
            data: { balanceUsdc },
        });
    }

    /**
     * Mark goal as completed
     */
    async completeGoal(goalId: string): Promise<Goal> {
        return this.prisma.goal.update({
            where: { goalId },
            data: { status: "COMPLETED" },
        });
    }

    /**
     * Cancel a goal
     */
    async cancelGoal(goalId: string): Promise<Goal> {
        return this.prisma.goal.update({
            where: { goalId },
            data: { status: "CANCELLED" },
        });
    }
}
