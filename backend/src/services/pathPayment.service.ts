import { StellarService } from "./stellar.service";
import * as StellarSdk from "@stellar/stellar-sdk";

export class PathPaymentService {
  private stellarService: StellarService;

  constructor() {
    this.stellarService = new StellarService();
  }

  /**
   * Discovers NGN -> USDC (or any asset to USDC) conversion routes.
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
              sourceAssetIssuer || "GAWEEQOIQ34O4YYUN4OTUMM2F2HVKJ6NYIKIUV6Z7O4PFWY3U5QY4MFI" // dummy/fallback issue, or expecting user to provide
            );
            
      // For USDC, we also need an issuer, unless we specify a known one on testnet/public
      const network = this.stellarService.getNetworkPassphrase();
      const usdcIssuer =
        network === StellarSdk.Networks.PUBLIC
          ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
          : "GBBD47IF6LWK7P7MDEVSCWTTCJM4TWCH6TZZRVDI0Z00USDC"; // default testnet issuer example

      const destAssets = [new StellarSdk.Asset("USDC", usdcIssuer)];

      const paths = await server.strictSendPaths(sourceAsset, sourceAmount, destAssets).call();
      
      // Map properties for easier frontend consumption
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
      console.error("Path payment quote error:", error);
      throw new Error("Failed to fetch path payment quotes");
    }
  }
}
