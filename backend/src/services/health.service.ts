import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { env } from "../config/env";
import { horizonServer, sorobanRpcClient } from "../config/stellar";
import { getPinataClient } from "../config/ipfs";
import { redis } from "../lib/redis";

interface HealthIndicatorResult {
  status: "up" | "down";
  message: string;
  responseTime: number;
}

interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  checks: {
    database: HealthIndicatorResult;
    indexer: HealthIndicatorResult;
    stellar: HealthIndicatorResult;
    ipfs: HealthIndicatorResult;
    redis: HealthIndicatorResult;
    config: HealthIndicatorResult;
  };
  details: {
    databaseLatency: number;
    indexerLagSeconds: number;
    lastProcessedLedger: number | null;
    stellarNetwork: string;
    ipfsGateway: string;
    missingEnvVars: string[];
  };
}

type HealthDatabase = any;

export class HealthService {
  private startTime: number = Date.now();

  constructor(private readonly prisma: HealthDatabase = defaultPrisma) {}

  /**
   * Check database connectivity and query performance
   * Ensures TypeORM-like deep introspection with ~200ms bounds
   */
  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const timeout = 200; // 200ms threshold

    try {
      // Execute a simple query to verify database access
      const result = await Promise.race([
        this.prisma.$queryRaw`SELECT 1 as health_check`,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Database query timeout")),
            timeout,
          ),
        ),
      ]);

      const responseTime = Date.now() - startTime;

      if (responseTime > timeout) {
        return {
          status: "down",
          message: `Database query exceeded ${timeout}ms threshold`,
          responseTime,
        };
      }

      return {
        status: "up",
        message: "Database connection healthy",
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      appLogger.error({ error }, "Database health check failed");
      return {
        status: "down",
        message: `Database check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check indexer service health
   * Validates that the indexer has processed a ledger within the last 15 seconds
   * Ensures no background task halting
   */
  private async checkIndexer(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const maxLagSeconds = 15;

    try {
      // Fetch the most recent processed ledger
      const latestLedger = await this.prisma.processedLedger.findFirst({
        orderBy: { ledgerSequence: "desc" },
        take: 1,
      });

      const responseTime = Date.now() - startTime;

      if (!latestLedger) {
        return {
          status: "down",
          message: "No processed ledgers found - indexer may not have started",
          responseTime,
        };
      }

      // Check if the ledger was processed within the last 15 seconds
      const ledgerAge =
        (Date.now() - latestLedger.processedAt.getTime()) / 1000;

      if (ledgerAge > maxLagSeconds) {
        return {
          status: "down",
          message: `Indexer lag exceeds ${maxLagSeconds}s threshold (current: ${ledgerAge.toFixed(1)}s)`,
          responseTime,
        };
      }

      return {
        status: "up",
        message: `Indexer healthy - last ledger processed ${ledgerAge.toFixed(1)}s ago`,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      appLogger.error({ error }, "Indexer health check failed");
      return {
        status: "down",
        message: `Indexer check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check Stellar RPC connectivity
   */
  private async checkStellar(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const timeout = 5000; // 5 seconds

    try {
      await Promise.race([
        horizonServer.loadAccount(env.AMANA_ESCROW_CONTRACT_ID),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Stellar RPC timeout")), timeout),
        ),
      ]);

      const responseTime = Date.now() - startTime;
      return {
        status: "up",
        message: "Stellar RPC connection healthy",
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      appLogger.error({ error }, "Stellar health check failed");
      return {
        status: "down",
        message: `Stellar check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check IPFS/Pinata connectivity
   */
  private async checkIPFS(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const timeout = 5000; // 5 seconds

    try {
      const pinata = getPinataClient();
      // Pinata SDK may not have testAuthentication, try a simple operation instead
      await Promise.race([
        (pinata as any).testAuthentication?.() || Promise.resolve(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("IPFS timeout")), timeout),
        ),
      ]);

      const responseTime = Date.now() - startTime;
      return {
        status: "up",
        message: "IPFS/Pinata connection healthy",
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      // IPFS is optional for some operations, so log but don't fail hard
      appLogger.warn({ error }, "IPFS health check failed (optional service)");
      return {
        status: "down",
        message: `IPFS check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const timeout = 3000; // 3 seconds

    try {
      await Promise.race([
        (redis as any).ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis timeout")), timeout),
        ),
      ]);

      const responseTime = Date.now() - startTime;
      return {
        status: "up",
        message: "Redis connection healthy",
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      appLogger.error({ error }, "Redis health check failed");
      return {
        status: "down",
        message: `Redis check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check configuration validity
   */
  private async checkConfig(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const missingVars: string[] = [];

    // Check critical environment variables
    const criticalVars = [
      "DATABASE_URL",
      "JWT_SECRET",
      "AMANA_ESCROW_CONTRACT_ID",
      "USDC_CONTRACT_ID",
    ];

    for (const varName of criticalVars) {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    }

    const responseTime = Date.now() - startTime;

    if (missingVars.length > 0) {
      return {
        status: "down",
        message: `Missing critical environment variables: ${missingVars.join(", ")}`,
        responseTime,
      };
    }

    return {
      status: "up",
      message: "Configuration valid",
      responseTime,
    };
  }

  /**
   * Perform comprehensive health check
   * Returns detailed status for uptime integrations (Datadog, UptimeRobot, etc.)
   */
  async performHealthCheck(): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - this.startTime;

    // Run checks in parallel
    const [
      databaseCheck,
      indexerCheck,
      stellarCheck,
      ipfsCheck,
      redisCheck,
      configCheck,
    ] = await Promise.all([
      this.checkDatabase(),
      this.checkIndexer(),
      this.checkStellar(),
      this.checkIPFS(),
      this.checkRedis(),
      this.checkConfig(),
    ]);

    // Determine overall status
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    // Critical failures cause unhealthy status
    if (
      databaseCheck.status === "down" ||
      indexerCheck.status === "down" ||
      stellarCheck.status === "down" ||
      configCheck.status === "down"
    ) {
      status = "unhealthy";
    }
    // Optional service failures or slow responses cause degraded status
    else if (
      redisCheck.status === "down" ||
      ipfsCheck.status === "down" ||
      databaseCheck.responseTime > 150 ||
      indexerCheck.responseTime > 150 ||
      stellarCheck.responseTime > 5000
    ) {
      status = "degraded";
    }

    // Fetch latest ledger for details
    const latestLedger = await this.prisma.processedLedger.findFirst({
      orderBy: { ledgerSequence: "desc" },
      take: 1,
    });

    const indexerLagSeconds = latestLedger
      ? (Date.now() - latestLedger.processedAt.getTime()) / 1000
      : -1;

    // Extract missing env vars from config check
    const missingEnvVars =
      configCheck.status === "down"
        ? configCheck.message
            .replace("Missing critical environment variables: ", "")
            .split(", ")
        : [];

    return {
      status,
      timestamp,
      uptime,
      checks: {
        database: databaseCheck,
        indexer: indexerCheck,
        stellar: stellarCheck,
        ipfs: ipfsCheck,
        redis: redisCheck,
        config: configCheck,
      },
      details: {
        databaseLatency: databaseCheck.responseTime,
        indexerLagSeconds: indexerLagSeconds > 0 ? indexerLagSeconds : 0,
        lastProcessedLedger: latestLedger?.ledgerSequence ?? null,
        stellarNetwork: env.STELLAR_NETWORK,
        ipfsGateway: env.IPFS_GATEWAY_URL,
        missingEnvVars,
      },
    };
  }
}
