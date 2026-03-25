import { StellarService } from "./stellar.service";

export class WalletService {
  private stellarService: StellarService;

  constructor() {
    this.stellarService = new StellarService();
  }

  /**
   * Returns the USDC balance on Stellar for the given wallet address.
   */
  public async getUsdcBalance(walletAddress: string): Promise<string> {
    // "USDC" is the default assetCode in StellarService.getAccountBalance
    return this.stellarService.getAccountBalance(walletAddress, "USDC");
  }
}
