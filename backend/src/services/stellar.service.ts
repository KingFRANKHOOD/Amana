import { Horizon, rpc, TransactionBuilder, BASE_FEE, StrKey, xdr } from '@stellar/stellar-sdk';
import { 
  horizonServer, 
  sorobanRpcClient, 
  networkPassphrase 
} from '../config/stellar';
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";
import { TOKEN_CONFIG } from "../config/token";
import {
  classifySubmissionError,
  recordTransactionSubmission,
} from "../lib/metrics";

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

public async getAccountBalance(publicKey: string, assetCode: string = TOKEN_CONFIG.symbol): Promise<string> {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new Error("Invalid Stellar public key");
    }

    return TracingHelper.withSpan(
      "stellar.get_account_balance",
      async (span) => {
        span.setAttributes({
          'stellar.operation': 'get_account_balance',
          'stellar.public_key': publicKey,
          'stellar.asset_code': assetCode,
          'stellar.network': this.networkPassphrase,
        });

        TracingHelper.addEvent('stellar_balance_query_start', { 
          publicKey: publicKey.substring(0, 8) + '...', // Partial for privacy
          assetCode 
        });

        try {
          const account = await retryAsync(() => this.horizonServer.loadAccount(publicKey));
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
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (status === 404) {
            return "0";
          }

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

  public async buildTransaction(sourceAccount: string, operations: xdr.Operation[]): Promise<string> {
    const start = performance.now();
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
      recordTransactionSubmission(
        "build_transaction",
        "success",
        performance.now() - start,
      );
      return transaction.toXDR();
    } catch (error: any) {
      recordTransactionSubmission(
        "build_transaction",
        classifySubmissionError(error),
        performance.now() - start,
      );
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
    return TracingHelper.withSpan(
      "stellar.submit_transaction",
      async (span) => {
        const start = performance.now();
        span.setAttributes({
          "stellar.operation": "submit_transaction",
          "stellar.network": this.networkPassphrase,
        });

        try {
          const transaction = TransactionBuilder.fromXDR(
            signedXdr,
            this.networkPassphrase,
          );

          const response = await this.sorobanRpc.sendTransaction(transaction as any);

          if (!response?.status) {
            recordTransactionSubmission(
              "submit_transaction",
              "rpc_error",
              performance.now() - start,
            );
            span.setAttributes({
              "stellar.transaction.outcome": "rpc_error",
            });
            appLogger.error({
              response,
              provider: "stellar",
              status: "authorization_failed",
              timestamp: new Date().toISOString(),
            }, "RPC Error");
            throw new Error("RPC Error: invalid response");
          }

          appLogger.info({
            provider: "stellar",
            status: response.status === "ERROR" ? "authorization_failed" : "provider_response",
            timestamp: new Date().toISOString(),
            hash: response.hash,
          }, "Transaction submitted");

          if (response.status === "ERROR") {
            if (response.errorResult) {
              const errorMessage = this.parseContractError(response.errorResult);
              recordTransactionSubmission(
                "submit_transaction",
                "contract_panic",
                performance.now() - start,
              );
              span.setAttributes({
                "stellar.transaction.outcome": "contract_panic",
                "stellar.transaction.hash": response.hash ?? "unknown",
              });
              appLogger.error({
                errorMessage,
                provider: "stellar",
                status: "authorization_denied",
                timestamp: new Date().toISOString(),
              }, "Contract Panic");
              throw new Error(`Contract Panic: ${errorMessage}`);
            }

            recordTransactionSubmission(
              "submit_transaction",
              "rpc_error",
              performance.now() - start,
            );
            span.setAttributes({
              "stellar.transaction.outcome": "rpc_error",
              "stellar.transaction.hash": response.hash ?? "unknown",
            });
            appLogger.error({
              response,
              provider: "stellar",
              status: "authorization_failed",
              timestamp: new Date().toISOString(),
            }, "RPC Error");
            throw new Error(`RPC Error: ${response.status}`);
          }

          recordTransactionSubmission(
            "submit_transaction",
            "success",
            performance.now() - start,
          );
          span.setAttributes({
            "stellar.transaction.outcome": "success",
            "stellar.transaction.hash": response.hash ?? "unknown",
          });
          return response;
        } catch (error: any) {
          const outcome = classifySubmissionError(error);
          if (
            outcome !== "contract_panic" &&
            outcome !== "rpc_error"
          ) {
            recordTransactionSubmission(
              "submit_transaction",
              outcome,
              performance.now() - start,
            );
          }

          span.setAttributes({
            "stellar.transaction.outcome": outcome,
          });

          if (error.message && error.message.includes("XDR")) {
            appLogger.error({ error }, "Invalid transaction XDR");
            throw new Error(`Invalid transaction XDR: ${error.message}`);
          }

          if (
            error.message &&
            (error.message.includes("RPC Error:") ||
              error.message.includes("Contract Panic:"))
          ) {
            throw error;
          }

          appLogger.error({ error }, "Transaction submission failed");
          throw new Error(
            `Transaction submission failed: ${error.message || "Unknown error"}`,
          );
        }
      },
      {
        attributes: {
          "service.name": "stellar",
          "operation.type": "external_service",
        },
      },
    );
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
