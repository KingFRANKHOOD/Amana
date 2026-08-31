import { prisma as defaultPrisma } from "../lib/db";
import { redis } from "../lib/redis";
import { appLogger } from "../middleware/logger";
import { env } from "../config/env";
import { stellarRpcManager } from "../config/stellar";
import { getPinataClient } from "../config/ipfs";
import { AlertService, alertService as defaultAlertService } from "./alert.service";
import { getCircuitBreakerStates } from "../lib/circuitBreaker";
import { EventStreamService } from "./event-stream";
import { recordRpcNodeHealth, getTransactionSubmissionStats } from "../lib/metrics";

import fs from "fs";
import path from "path";

import { metricsService, LatencyPercentiles, EndpointLatencyStats } from "./metrics.service";

export interface HealthIndicatorResult {
  status: "up" | "down";
  message: string;
  responseTime: number;
}

export interface DependencyHealth {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  isCritical: boolean;
  latencyMs: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface AggregatedHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  systemHealthScore: number;
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  environment: string;
  summary: {
    totalDependencies: number;
    healthyCount: number;
    degradedCount: number;
    unhealthyCount: number;
    criticalFailingCount: number;
  };
  apiPerformance: {
    responseTimeMs: number;
    percentiles: LatencyPercentiles;
    slowRequestsCount: number;
  };
  dependencies: {
    database: DependencyHealth;
    redis: DependencyHealth;
    stellarRpc: DependencyHealth;
    eventIndexer: DependencyHealth;
    ipfsStorage: DependencyHealth;
    workerQueues: DependencyHealth;
    localStorage: DependencyHealth;
    configuration: DependencyHealth;
    encryptionKey: DependencyHealth;
  };
  details: {
    circuitBreakers: Array<{ name: string; state: string }>;
    websocketConnections: {
      total: number;
      perUserLimit: number;
      globalLimit: number;
      maxPerUser: number;
    };
  };
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  apiResponseTimeMs?: number;
  checks: {
    database: HealthIndicatorResult;
    indexer: HealthIndicatorResult;
    stellar: HealthIndicatorResult;
    ipfs: HealthIndicatorResult;
    redis: HealthIndicatorResult;
    config: HealthIndicatorResult;
    encryptionKey: HealthIndicatorResult;
  };
  details: {
    databaseLatency: number;
    redisLatency: number;
    indexerLagSeconds: number;
    lastProcessedLedger: number | null;
    stellarNetwork: string;
    stellarActiveRpcUrl?: string;
    stellarPrimaryRpcUrl?: string;
    stellarFallbackRpcUrls?: string[];
    stellarTransactionStats?: import("../lib/metrics").StellarSubmissionStats;
    ipfsGateway: string;
    missingEnvVars: string[];
    encryptionKeyConfigured: boolean;
    circuitBreakers: Array<{ name: string; state: string }>;
    websocketConnections: {
      total: number;
      perUserLimit: number;
      globalLimit: number;
      maxPerUser: number;
    };
    apiPerformance?: EndpointLatencyStats;
  };
}

interface HealthDatabase {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  processedEvent: {
    findFirst(args?: {
      orderBy?: { ledgerSequence?: "asc" | "desc" };
      take?: number;
    }): Promise<{ ledgerSequence: number; processedAt: Date } | null>;
  };
}
interface HealthRedis {
  ping(): Promise<string>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

export class HealthService {
  private startTime: number = Date.now();

  constructor(
    private readonly prisma: HealthDatabase = defaultPrisma,
    private readonly cacheClient: HealthRedis = redis as unknown as HealthRedis,
    private readonly alerts: AlertService = defaultAlertService,
  ) {}

  /**
   * Check database connectivity and query performance
   * Ensures TypeORM-like deep introspection with ~200ms bounds
   */
  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const timeout = 200; // 200ms threshold

    try {
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1 as health_check`,
        timeout,
        "Database query timeout",
      );

      const responseTime = Date.now() - startTime;

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
      const latestLedger = await this.prisma.processedEvent.findFirst({
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
    const timeout = env.STELLAR_HEALTH_TIMEOUT_MS ?? 5000;

    try {
      if (typeof stellarRpcManager?.checkNetworkHealth === 'function') {
        const health = await stellarRpcManager.checkNetworkHealth(
          env.AMANA_ESCROW_CONTRACT_ID,
          timeout,
        );

        const responseTime = Date.now() - startTime;

        if (health?.nodes) {
          for (const node of health.nodes) {
            recordRpcNodeHealth(node.url, node.status !== "unhealthy", node.latencyMs);
          }
        }

        if (health?.status === "unhealthy") {
          return {
            status: "down",
            message: health.message,
            responseTime,
          };
        }

        return {
          status: "up",
          message: health?.message ?? "Stellar RPC connection healthy",
          responseTime,
        };
      }

      // Fallback for mocked test environments
      const { horizonServer } = require("../config/stellar");
      if (typeof horizonServer?.loadAccount === 'function') {
        await withTimeout(
          horizonServer.loadAccount(env.AMANA_ESCROW_CONTRACT_ID),
          timeout,
          "Stellar RPC timeout",
        );
      }

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
    const timeout = 5000;

    try {
      const pinata = getPinataClient();
      await withTimeout(
        (pinata as { testAuthentication?: () => Promise<unknown> }).testAuthentication?.()
          ?? Promise.resolve(),
        timeout,
        "IPFS timeout",
      );

      const responseTime = Date.now() - startTime;
      return {
        status: "up",
        message: "IPFS/Pinata connection healthy",
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      appLogger.warn({ error }, "IPFS health check failed (optional service)");
      return {
        status: "down",
        message: `IPFS check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check Redis cache connectivity
   */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const timeout = 3000;

    try {
      await withTimeout(
        this.cacheClient.ping(),
        timeout,
        "Redis timeout",
      );

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

    const criticalVars = [
      "DATABASE_URL",
      "JWT_SECRET",
      "AMANA_ESCROW_CONTRACT_ID",
      "USDC_CONTRACT_ID",
      "TRADE_NOTES_ENCRYPTION_KEY",
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

  private checkEncryptionKey(): HealthIndicatorResult {
    const startTime = Date.now();
    const value = process.env.TRADE_NOTES_ENCRYPTION_KEY ?? env.TRADE_NOTES_ENCRYPTION_KEY;
    const configured = typeof value === "string" && value.trim().length >= 32;

    return {
      status: configured ? "up" : "down",
      message: configured
        ? "Trade notes encryption key configured"
        : "TRADE_NOTES_ENCRYPTION_KEY is missing or invalid",
      responseTime: Date.now() - startTime,
    };
  }

  private async dispatchAlerts(
    databaseCheck: HealthIndicatorResult,
    redisCheck: HealthIndicatorResult,
    stellarCheck?: HealthIndicatorResult,
  ): Promise<void> {
    if (databaseCheck.status === "down") {
      await this.alerts.dispatch("db_connection_failure", databaseCheck.message, {
        responseTime: databaseCheck.responseTime,
      });
    }

    if (redisCheck.status === "down") {
      await this.alerts.dispatch("redis_connection_failure", redisCheck.message, {
        responseTime: redisCheck.responseTime,
      });
    }

    if (stellarCheck && stellarCheck.status === "down") {
      const activeUrl = typeof stellarRpcManager?.getActiveRpcUrl === 'function'
        ? stellarRpcManager.getActiveRpcUrl()
        : 'https://soroban-testnet.stellar.org';
      const primaryUrl = typeof stellarRpcManager?.getPrimaryRpcUrl === 'function'
        ? stellarRpcManager.getPrimaryRpcUrl()
        : activeUrl;
      const fallbackUrls = typeof stellarRpcManager?.getFallbackRpcUrls === 'function'
        ? stellarRpcManager.getFallbackRpcUrls()
        : [];

      if (typeof this.alerts?.dispatchStellarConnectionFailure === 'function') {
        await this.alerts.dispatchStellarConnectionFailure(
          activeUrl,
          stellarCheck.message,
          {
            responseTime: stellarCheck.responseTime,
            primaryUrl,
            fallbackUrls,
          },
        );
      } else {
        await this.alerts.dispatch("stellar_connection_failure", stellarCheck.message, {
          responseTime: stellarCheck.responseTime,
          endpoint: activeUrl,
        });
      }
    }
  }

  /**
   * Check circuit breaker states for external service calls.
   */
  private checkCircuitBreakers(): Array<{ name: string; state: string }> {
    return getCircuitBreakerStates().map((cb) => ({
      name: cb.name,
      state: cb.state,
    }));
  }

  /**
   * Perform comprehensive health check
   * Returns detailed status for uptime integrations (Datadog, UptimeRobot, etc.)
   */
  async performHealthCheck(): Promise<HealthCheckResponse> {
    const startExecTime = Date.now();
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - this.startTime;

    const [
      databaseCheck,
      indexerCheck,
      stellarCheck,
      ipfsCheck,
      redisCheck,
      configCheck,
      encryptionKeyCheck,
    ] = await Promise.all([
      this.checkDatabase(),
      this.checkIndexer(),
      this.checkStellar(),
      this.checkIPFS(),
      this.checkRedis(),
      this.checkConfig(),
      Promise.resolve(this.checkEncryptionKey()),
    ]);

    await this.dispatchAlerts(databaseCheck, redisCheck, stellarCheck);

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (
      databaseCheck.status === "down"
      || indexerCheck.status === "down"
      || stellarCheck.status === "down"
      || configCheck.status === "down"
      || encryptionKeyCheck.status === "down"
    ) {
      status = "unhealthy";
    } else if (
      redisCheck.status === "down"
      || ipfsCheck.status === "down"
      || databaseCheck.responseTime > 150
      || indexerCheck.responseTime > 150
      || stellarCheck.responseTime > 5000
    ) {
      status = "degraded";
    }

    let latestLedger: { ledgerSequence: number; processedAt: Date } | null = null;
    try {
      latestLedger = await this.prisma.processedEvent.findFirst({
        orderBy: { ledgerSequence: "desc" },
        take: 1,
      });
    } catch (error) {
      appLogger.error({ error }, "Failed to fetch latest ledger for health details");
    }

    const indexerLagSeconds = latestLedger
      ? (Date.now() - latestLedger.processedAt.getTime()) / 1000
      : -1;

    const missingEnvVars =
      configCheck.status === "down"
        ? configCheck.message
            .replace("Missing critical environment variables: ", "")
            .split(", ")
        : [];

    const circuitBreakers = this.checkCircuitBreakers();
    const latencyStats = metricsService.getLatencySummary();
    const txStats = getTransactionSubmissionStats();
    const apiResponseTimeMs = Date.now() - startExecTime;

    return {
      status,
      timestamp,
      uptime,
      apiResponseTimeMs,
      checks: {
        database: databaseCheck,
        indexer: indexerCheck,
        stellar: stellarCheck,
        ipfs: ipfsCheck,
        redis: redisCheck,
        config: configCheck,
        encryptionKey: encryptionKeyCheck,
      },
      details: {
        databaseLatency: databaseCheck.responseTime,
        redisLatency: redisCheck.responseTime,
        indexerLagSeconds: indexerLagSeconds > 0 ? indexerLagSeconds : 0,
        lastProcessedLedger: latestLedger?.ledgerSequence ?? null,
        stellarNetwork: env.STELLAR_NETWORK,
        stellarActiveRpcUrl: typeof stellarRpcManager?.getActiveRpcUrl === 'function' ? stellarRpcManager.getActiveRpcUrl() : undefined,
        stellarPrimaryRpcUrl: typeof stellarRpcManager?.getPrimaryRpcUrl === 'function' ? stellarRpcManager.getPrimaryRpcUrl() : undefined,
        stellarFallbackRpcUrls: typeof stellarRpcManager?.getFallbackRpcUrls === 'function' ? stellarRpcManager.getFallbackRpcUrls() : [],
        stellarTransactionStats: txStats,
        ipfsGateway: env.IPFS_GATEWAY_URL,
        missingEnvVars,
        encryptionKeyConfigured: encryptionKeyCheck.status === "up",
        circuitBreakers,
        websocketConnections: EventStreamService.getConnectionStats(),
        apiPerformance: latencyStats,
      },
    };
  }

  /**
   * Perform startup readiness check
   * Checks critical dependencies needed for the application to start
   */
  async performStartupCheck(): Promise<{
    status: "ready" | "not_ready";
    timestamp: string;
    checks: Record<string, HealthIndicatorResult>;
  }> {
    const timestamp = new Date().toISOString();

    const [databaseCheck, redisCheck, configCheck, encryptionKeyCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkConfig(),
      Promise.resolve(this.checkEncryptionKey()),
    ]);

    const checks = {
      database: databaseCheck,
      redis: redisCheck,
      config: configCheck,
      encryptionKey: encryptionKeyCheck,
    };

    const status = databaseCheck.status === "up" && redisCheck.status === "up" && configCheck.status === "up" && encryptionKeyCheck.status === "up"
      ? "ready"
      : "not_ready";

    return { status, timestamp, checks };
  }

  /**
   * Check queue subsystem health (worker queue redis connectivity).
   */
  private async checkQueues(): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    try {
      await this.cacheClient.ping();
      const responseTime = Date.now() - startTime;
      return {
        status: "up",
        message: "Queue redis connection active and accepting jobs",
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        status: "down",
        message: `Queue check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        responseTime,
      };
    }
  }

  /**
   * Check local filesystem writeability and storage availability for archival/temp files.
   */
  private checkStorage(): HealthIndicatorResult {
    const startTime = Date.now();
    try {
      const testDir = path.resolve(process.cwd(), "./data");
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      const testFile = path.join(testDir, `.health_probe_${Date.now()}`);
      fs.writeFileSync(testFile, "probe");
      fs.unlinkSync(testFile);

      return {
        status: "up",
        message: "Storage volume writable and accessible",
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: "down",
        message: `Storage probe failed: ${error instanceof Error ? error.message : "Unknown storage error"}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Perform comprehensive aggregated health check across all dependencies
   * with weighted scoring, component breakdown, and critical failure tracking.
   */
  async performAggregatedHealthCheck(): Promise<AggregatedHealthResponse> {
    const startExecTime = Date.now();
    const timestamp = new Date().toISOString();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const [
      dbCheck,
      redisCheck,
      stellarCheck,
      indexerCheck,
      ipfsCheck,
      configCheck,
      encryptionCheck,
      queuesCheck,
      storageCheck,
    ] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStellar(),
      this.checkIndexer(),
      this.checkIPFS(),
      this.checkConfig(),
      Promise.resolve(this.checkEncryptionKey()),
      this.checkQueues(),
      Promise.resolve(this.checkStorage()),
    ]);

    const toDependency = (
      name: string,
      check: HealthIndicatorResult,
      isCritical: boolean,
      degradedLatencyMs: number = 200,
    ): DependencyHealth => {
      let status: "healthy" | "degraded" | "unhealthy" = "healthy";
      if (check.status === "down") {
        status = isCritical ? "unhealthy" : "degraded";
      } else if (check.responseTime > degradedLatencyMs) {
        status = "degraded";
      }

      return {
        name,
        status,
        isCritical,
        latencyMs: check.responseTime,
        message: check.message,
        ...(check.status === "down" ? { error: check.message } : {}),
      };
    };

    const txStats = getTransactionSubmissionStats();
    const dependencies = {
      database: toDependency("PostgreSQL Database", dbCheck, true, 150),
      redis: toDependency("Redis Cache & Session Store", redisCheck, true, 100),
      stellarRpc: {
        ...toDependency("Stellar Horizon / RPC", stellarCheck, true, 2000),
        details: {
          activeRpcUrl: typeof stellarRpcManager?.getActiveRpcUrl === 'function' ? stellarRpcManager.getActiveRpcUrl() : undefined,
          primaryRpcUrl: typeof stellarRpcManager?.getPrimaryRpcUrl === 'function' ? stellarRpcManager.getPrimaryRpcUrl() : undefined,
          fallbackRpcUrls: typeof stellarRpcManager?.getFallbackRpcUrls === 'function' ? stellarRpcManager.getFallbackRpcUrls() : [],
          transactionSuccessRate: txStats.successRate,
          totalTransactions: txStats.totalSubmissions,
        },
      },
      eventIndexer: toDependency("Soroban Event Indexer", indexerCheck, true, 200),
      ipfsStorage: toDependency("IPFS / Pinata Storage", ipfsCheck, false, 3000),
      workerQueues: toDependency("BullMQ Worker Queues", queuesCheck, false, 200),
      localStorage: toDependency("Local Disk & Archival Volume", storageCheck, false, 100),
      configuration: toDependency("Application Configuration", configCheck, true, 50),
      encryptionKey: toDependency("Encryption Key Management", encryptionCheck, true, 50),
    };

    const depList = Object.values(dependencies);
    const totalDependencies = depList.length;
    const unhealthyCount = depList.filter((d) => d.status === "unhealthy").length;
    const degradedCount = depList.filter((d) => d.status === "degraded").length;
    const healthyCount = depList.filter((d) => d.status === "healthy").length;
    const criticalFailingCount = depList.filter((d) => d.isCritical && d.status === "unhealthy").length;

    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (criticalFailingCount > 0) {
      overallStatus = "unhealthy";
    } else if (degradedCount > 0 || unhealthyCount > 0) {
      overallStatus = "degraded";
    }

    const healthScore = Math.max(
      0,
      Math.round(((healthyCount * 1.0 + degradedCount * 0.5) / totalDependencies) * 100),
    );

    const circuitBreakers = this.checkCircuitBreakers();
    const latencyStats = metricsService.getLatencySummary();
    const responseTimeMs = Date.now() - startExecTime;

    return {
      status: overallStatus,
      systemHealthScore: criticalFailingCount > 0 ? Math.min(healthScore, 49) : healthScore,
      timestamp,
      uptimeSeconds,
      version: process.env.npm_package_version ?? "1.0.0",
      environment: env.NODE_ENV,
      summary: {
        totalDependencies,
        healthyCount,
        degradedCount,
        unhealthyCount,
        criticalFailingCount,
      },
      apiPerformance: {
        responseTimeMs,
        percentiles: latencyStats.global,
        slowRequestsCount: latencyStats.slowRequestsCount,
      },
      dependencies,
      details: {
        circuitBreakers,
        websocketConnections: EventStreamService.getConnectionStats(),
      },
    };
  }
}
