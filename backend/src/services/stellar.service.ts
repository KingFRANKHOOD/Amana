import * as StellarSdk from "@stellar/stellar-sdk";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";

export class StellarService {
  private server: StellarSdk.Horizon.Server;
  private networkPassphrase: string;
  private networkType: string;

  constructor() {
    this.networkType = process.env.STELLAR_NETWORK || "TESTNET";
    if (this.networkType === "PUBLIC") {
      this.server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
      this.networkPassphrase = StellarSdk.Networks.PUBLIC;
    } else {
      this.server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
      this.networkPassphrase = StellarSdk.Networks.TESTNET;
    }
  }

  public getServer(): StellarSdk.Horizon.Server {
    return this.server;
  }

  public getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  public async getAccountBalance(publicKey: string, assetCode: string = "USDC"): Promise<string> {
    return TracingHelper.withSpan(
      "stellar.get_account_balance",
      async (span) => {
        span.setAttributes({
          'stellar.operation': 'get_account_balance',
          'stellar.public_key': publicKey,
          'stellar.asset_code': assetCode,
          'stellar.network': this.networkType,
        });

        TracingHelper.addEvent('stellar_balance_query_start', { 
          publicKey: publicKey.substring(0, 8) + '...', // Partial for privacy
          assetCode 
        });

        try {
          const account = await this.server.loadAccount(publicKey);
          const balance = account.balances.find((b: any) => {
            if (assetCode === "XLM") {
              return b.asset_type === "native";
            }
            return b.asset_code === assetCode;
          });

          const balanceAmount = balance ? balance.balance : "0";

          span.setAttributes({
            'stellar.balance_found': !!balance,
            'stellar.balance_amount': balanceAmount,
          });

          TracingHelper.addEvent('stellar_balance_success', { 
            balanceFound: !!balance,
            balanceAmount 
          });

          appLogger.info(
            { 
              publicKey: publicKey.substring(0, 8) + '...', 
              assetCode, 
              balance: balanceAmount 
            }, 
            "[StellarService] Account balance retrieved successfully"
          );

          return balanceAmount;
        } catch (error) {
          span.setAttributes({
            'stellar.balance_found': false,
            'stellar.error': error instanceof Error ? error.message : 'Unknown error',
          });

          TracingHelper.addEvent('stellar_balance_error', { 
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          appLogger.error({ error, publicKey: publicKey.substring(0, 8) + '...' }, "Failed to get account balance");
          throw new Error("Unable to fetch balance");
        }
      },
      {
        attributes: {
          'service.name': 'stellar',
          'operation.type': 'external_service',
        }
      }
    );
  }
}
