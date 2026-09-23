import { StellarService } from "./stellar.service";
import * as StellarSdk from "@stellar/stellar-sdk";
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";
import { USDC_ISSUER_MAINNET, USDC_ISSUER_TESTNET } from "../config/stellar";
import { CircuitBreaker, CircuitBreakerOpenError } from "../lib/circuitBreaker";
import { AppError } from "../errors/appError";
import { ErrorCode } from "../errors/errorCodes";

function isHorizonInfraError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  const status = e?.response?.status ?? e?.status;
  if (typeof status === "number" && [429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("horizon") ||
    msg.includes("unavailable") ||
    msg.includes("connect")
  )
    return true;
  // Malformed upstream responses or unhandled TypeErrors should be treated as internal 500
  // Only explicit infra patterns above qualify for 503.
  return false;
}

export class PathPaymentService {
  private stellarService: StellarService;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(circuitBreaker?: CircuitBreaker) {
    this.stellarService = new StellarService();
    this.circuitBreaker =
      circuitBreaker ??
      new CircuitBreaker("horizon-path-payment", {
        failureThreshold: 5,
        successThreshold: 2,
        cooldownMs: 30_000,
      });
  }

  /**
   * Discovers NGN -> USDC (or any asset to USDC) conversion routes.
   * Retries on transient errors and trips a circuit breaker on sustained Horizon outages.
   */
  public async getPathPaymentQuote(
    sourceAmount: string,
    sourceAssetCode: string,
    sourceAssetIssuer?: string
  ): Promise<any[]> {
    try {
      const server = this.stellarService.getServer();

      const sourceAsset =
        sourceAssetCode === "XLM" || sourceAssetCode === "native"
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(
              sourceAssetCode,
              sourceAssetIssuer || "GASIVS63V6PAKAMW3ZYEX2RNNB3Q4UMRKDIQHNMH3LRNTSWVHXMTANKE"
            );

      const network = this.stellarService.getNetworkPassphrase();
      const usdcIssuer =
        network === StellarSdk.Networks.PUBLIC
          ? USDC_ISSUER_MAINNET
          : USDC_ISSUER_TESTNET;

      const destAssets = [new StellarSdk.Asset("USDC", usdcIssuer)];

      const paths = await this.circuitBreaker.call(() =>
        retryAsync(() =>
          server.strictSendPaths(sourceAsset, sourceAmount, destAssets).call()
        )
      );

      return paths.records.map((record) => ({
        source_amount: record.source_amount,
        source_asset_type: record.source_asset_type,
        source_asset_code: record.source_asset_code,
        destination_amount: record.destination_amount,
        destination_asset_type: record.destination_asset_type,
        destination_asset_code: record.destination_asset_code,
        path: record.path,
      }));
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        appLogger.warn(
          { error: error.message, circuit: this.circuitBreaker.currentState },
          "Path payment circuit breaker open",
        );
        throw new AppError(
          ErrorCode.SERVICE_UNAVAILABLE,
          "Payment service temporarily unavailable",
          503,
          { circuitState: this.circuitBreaker.currentState, originalError: error.message },
        );
      }

      // Distinguish infrastructure / Horizon failures (503) from internal bugs (500)
      const isInfraError = isHorizonInfraError(error);
      const statusCode = isInfraError ? 503 : 500;
      const code = isInfraError ? ErrorCode.INFRA_ERROR : ErrorCode.INTERNAL_ERROR;

      appLogger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          details: error,
          statusCode,
          code,
        },
        "Path payment quote error",
      );

      throw new AppError(code, "Failed to fetch path payment quotes", statusCode, {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
