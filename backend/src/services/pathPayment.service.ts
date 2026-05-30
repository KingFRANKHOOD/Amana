import { StellarService } from "./stellar.service";
import * as StellarSdk from "@stellar/stellar-sdk";
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";
import { USDC_ISSUER_MAINNET, USDC_ISSUER_TESTNET } from "../config/stellar";
import { CircuitBreaker, CircuitBreakerOpenError } from "../lib/circuitBreaker";

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
        appLogger.warn({ error }, "Path payment circuit breaker open");
        throw new Error("Payment service temporarily unavailable");
      }
      appLogger.error({ error }, "Path payment quote error");
      throw new Error("Failed to fetch path payment quotes");
    }
  }
}
