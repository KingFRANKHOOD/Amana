import { StellarService } from "./stellar.service";
import { TOKEN_CONFIG } from "../config/token";

export class WalletService {
  private stellarService: StellarService;

  constructor() {
    this.stellarService = new StellarService();
  }

  /**
   * Returns the token balance on Stellar for the given wallet address.
   */
  public async getTokenBalance(walletAddress: string): Promise<string> {
    return this.stellarService.getAccountBalance(walletAddress, TOKEN_CONFIG.symbol);
  }

  /** Legacy method for compatibility during transition */
  public async getUsdcBalance(walletAddress: string): Promise<string> {
    return this.getTokenBalance(walletAddress);
  }
}

