import { Horizon, rpc, TransactionBuilder, BASE_FEE, xdr } from '@stellar/stellar-sdk';
import { 
  horizonServer, 
  sorobanRpcClient, 
  networkPassphrase 
} from '../config/stellar';
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";

export class StellarService {
  private horizonServer: Horizon.Server;
  private sorobanRpc: rpc.Server;
  private networkPassphrase: string;

  constructor() {
    this.horizonServer = horizonServer;
    this.sorobanRpc = sorobanRpcClient;
    this.networkPassphrase = networkPassphrase;
  }

  // Temporary backward compatibility methods - to be removed
  public getServer(): Horizon.Server {
    return this.horizonServer;
  }

  public getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  public async getAccountBalance(publicKey: string, assetCode: string = "USDC"): Promise<string> {
    try {
      const account = await retryAsync(() => this.horizonServer.loadAccount(publicKey));
      const balance = account.balances.find((b: any) => {
        if (assetCode === "XLM") {
          return b.asset_type === "native";
        }
        return b.asset_code === assetCode;
      });
      return balance ? balance.balance : "0";
    } catch (error) {
      appLogger.error({ error, publicKey }, "Failed to get account balance");
      throw new Error("Unable to fetch balance");
    }
  }

  public async buildTransaction(sourceAccount: string, operations: xdr.Operation[]): Promise<string> {
    try {
      // Load source account from Horizon to get sequence number
      const account = await this.horizonServer.loadAccount(sourceAccount);
      
      // Create TransactionBuilder with source, fee, and network passphrase
      const transactionBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      });
      
      // Add all operations to builder
      for (const operation of operations) {
        transactionBuilder.addOperation(operation);
      }
      
      // Set transaction timeout (180 seconds)
      transactionBuilder.setTimeout(180);
      
      // Build and return transaction.toXDR() as base64 string
      const transaction = transactionBuilder.build();
      return transaction.toXDR();
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        appLogger.error({ error, sourceAccount }, "Source account not found");
        throw new Error("Source account does not exist");
      }
      if (error.message && error.message.includes('operation')) {
        appLogger.error({ error }, "Invalid transaction operations");
        throw new Error(`Invalid transaction operations: ${error.message}`);
      }
      appLogger.error({ error }, "Failed to build transaction");
      throw new Error(`Failed to build transaction: ${error.message || 'Unknown error'}`);
    }
  }

  public async submitTransaction(signedXdr: string): Promise<rpc.Api.SendTransactionResponse> {
    try {
      // Parse XDR into Transaction object
      const transaction = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
      
      // Call sorobanRpc.sendTransaction(transaction)
      const response = await this.sorobanRpc.sendTransaction(transaction as any);
      
      // Log transaction hash for debugging
      appLogger.info({ hash: response.hash }, "Transaction submitted");
      
      // Check response status
      if (response.status === 'ERROR') {
        // Differentiate between RPC errors and contract panics
        if (response.errorResult) {
          // Contract panic - execution failure
          const errorMessage = this.parseContractError(response.errorResult);
          appLogger.error({ errorMessage }, "Contract Panic");
          throw new Error(`Contract Panic: ${errorMessage}`);
        } else {
          // RPC error - infrastructure failure
          appLogger.error({ response }, "RPC Error");
          throw new Error(`RPC Error: ${response.status}`);
        }
      }
      
      // Return response on success
      return response;
    } catch (error: any) {
      // Handle XDR parsing errors
      if (error.message && error.message.includes('XDR')) {
        appLogger.error({ error }, "Invalid transaction XDR");
        throw new Error(`Invalid transaction XDR: ${error.message}`);
      }
      
      // Re-throw if already a formatted error
      if (error.message && (error.message.includes('RPC Error:') || error.message.includes('Contract Panic:'))) {
        throw error;
      }
      
      // Handle network/timeout errors
      appLogger.error({ error }, "Transaction submission failed");
      throw new Error(`Transaction submission failed: ${error.message || 'Unknown error'}`);
    }
  }

  private parseContractError(errorResult: any): string {
    // Extract meaningful error message from contract error result
    try {
      if (typeof errorResult === 'string') {
        return errorResult;
      }
      // Return JSON stringified version for objects
      return JSON.stringify(errorResult);
    } catch {
      return 'Unknown contract error';
    }
  }
}
