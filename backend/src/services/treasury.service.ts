import { StellarService } from "./stellar.service";
import { TOKEN_CONFIG } from "../config/token";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { isMediatorAddress } from "../lib/accessControl";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';

export class TreasuryService {
  private stellarService: StellarService;

  constructor() {
    this.stellarService = new StellarService();
  }

  async getBalance(): Promise<{
    balance: string;
    asset: string;
    contractId: string;
  }> {
    const contractId = env.AMANA_ESCROW_CONTRACT_ID;
    const balance = await this.stellarService.getAccountBalance(
      contractId,
      TOKEN_CONFIG.symbol,
    );

    return {
      balance,
      asset: TOKEN_CONFIG.symbol,
      contractId,
    };
  }

  async withdraw(
    destination: string,
    amount: string,
    callerAddress: string,
  ): Promise<{ unsignedXdr: string }> {
    if (!this.isAdmin(callerAddress)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        "Only admin can withdraw treasury funds",
        403,
      );
    }

    appLogger.info(
      { destination, amount, caller: callerAddress },
      "Treasury withdrawal requested",
    );

    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Treasury withdrawal is not yet implemented. This endpoint is a stub.",
      501,
    );
  }

  getConfig(): {
    contractId: string;
    network: string;
    asset: string;
  } {
    return {
      contractId: env.AMANA_ESCROW_CONTRACT_ID,
      network: process.env.STELLAR_NETWORK ?? env.STELLAR_NETWORK,
      asset: TOKEN_CONFIG.symbol,
    };
  }

  private isAdmin(address: string): boolean {
    return isMediatorAddress(address);
  }
}

export const treasuryService = new TreasuryService();
