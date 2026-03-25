import * as StellarSdk from "@stellar/stellar-sdk";

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
    try {
      const account = await this.server.loadAccount(publicKey);
      const balance = account.balances.find((b: any) => {
        if (assetCode === "XLM") {
          return b.asset_type === "native";
        }
        return b.asset_code === assetCode;
      });
      return balance ? balance.balance : "0";
    } catch (error) {
      console.error(`Failed to get balance for ${publicKey}:`, error);
      throw new Error("Unable to fetch balance");
    }
  }
}
