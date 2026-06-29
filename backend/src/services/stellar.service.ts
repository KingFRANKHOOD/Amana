import { Horizon, rpc, TransactionBuilder, BASE_FEE, StrKey, xdr, scValToNative } from '@stellar/stellar-sdk';
import { 
  horizonServer, 
  sorobanRpcClient, 
  networkPassphrase 
} from '../config/stellar';
import { retryAsync } from "../lib/retry";
import { withCircuitBreaker, CircuitBreaker, getCircuitBreaker } from "../lib/circuit-breaker";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";
import { TOKEN_CONFIG } from "../config/token";
import {
  classifySubmissionError,
  recordTransactionSubmission,
} from "../lib/metrics";
import {
  classifyStellarServiceError,
  StellarError,
} from "../errors/service.errors";

export type StellarErrorCategory =
  | "timeout"
  | "connection_refused"
  | "not_found"
  | "rate_limited"
  | "invalid_xdr"
  | "contract_panic"
  | "rpc_error"
  | "network_error";

export interface ClassifiedStellarError {
  category: StellarErrorCategory;
  message: string;
  isRetryable: boolean;
}

export interface ContractTradeState {
  tradeId?: string;
  buyer?: string;
  seller?: string;
  token?: string;
  amount?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  fundedAt?: string | null;
  deliveredAt?: string | null;
  buyerLossBps?: number;
  sellerLossBps?: number;
  expiresAt?: string | null;
  [key: string]: unknown;
}

export function classifyStellarError(error: unknown): ClassifiedStellarError {
  const msg = error instanceof Error ? error.message : String(error);
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  const status =
    error !== null &&
    typeof error === "object" &&
    "response" in error &&
    error.response !== null &&
    typeof error.response === "object" &&
    "status" in error.response
      ? (error.response as { status: unknown }).status
      : undefined;

  if (code === "ETIMEDOUT" || code === "ECONNABORTED" || /timeout|timed out|deadline exceeded/i.test(msg)) {
    return { category: "timeout", message: `Stellar RPC timed out: ${msg}`, isRetryable: true };
  }

  if (code === "ECONNREFUSED" || /connection refused/i.test(msg)) {
    return { category: "connection_refused", message: `Stellar service unavailable: ${msg}`, isRetryable: true };
  }

  if (status === 404 || /not found/i.test(msg)) {
    return { category: "not_found", message: msg, isRetryable: false };
  }

  if (status === 429 || /rate limit/i.test(msg) || /TRY_AGAIN_LATER/i.test(msg)) {
    return { category: "rate_limited", message: `Stellar rate limited: ${msg}`, isRetryable: true };
  }

  if (/invalid.*xdr|xdr/i.test(msg)) {
    return { category: "invalid_xdr", message: `Invalid transaction XDR: ${msg}`, isRetryable: false };
  }

  if (/contract panic/i.test(msg)) {
    return { category: "contract_panic", message: msg, isRetryable: false };
  }

  if (/rpc error/i.test(msg)) {
    return { category: "rpc_error", message: msg, isRetryable: false };
  }

  return { category: "network_error", message: `Stellar network error: ${msg}`, isRetryable: true };
}

function isValidSorobanContractId(contractId: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(contractId);
}

function normalizeTradeState(value: unknown): ContractTradeState {
  if (value instanceof Map) {
    return normalizeTradeMap(value);
  }

  if (typeof value === "object" && value !== null) {
    return normalizeTradeObject(value as Record<string, unknown>);
  }

  return { value: normalizeScValue(value) };
}

function normalizeTradeMap(value: Map<unknown, unknown>): ContractTradeState {
  const raw: Record<string, unknown> = {};
  for (const [key, mapValue] of value.entries()) {
    raw[String(key)] = mapValue;
  }
  return normalizeTradeObject(raw);
}

function normalizeTradeObject(value: Record<string, unknown>): ContractTradeState {
  const aliases: Record<string, string> = {
    amount: "amount",
    buyer: "buyer",
    buyer_loss_bps: "buyerLossBps",
    created_at: "createdAt",
    delivered_at: "deliveredAt",
    expires_at: "expiresAt",
    funded_at: "fundedAt",
    seller: "seller",
    seller_loss_bps: "sellerLossBps",
    status: "status",
    token: "token",
    trade_id: "tradeId",
    updated_at: "updatedAt",
  };

  return Object.entries(value).reduce<ContractTradeState>((state, [key, raw]) => {
    state[aliases[key] ?? key] = normalizeScValue(raw);
    return state;
  }, {});
}

function normalizeScValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) return normalizeTradeMap(value);
  if (Array.isArray(value)) return value.map(normalizeScValue);
  if (typeof value === "object" && value !== null) {
    if ("toString" in value && value.constructor?.name === "Address") {
      return String(value);
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (record, [key, raw]) => {
        record[key] = normalizeScValue(raw);
        return record;
      },
      {},
    );
  }
  return value;
}

function extractContractDataScVal(entry: unknown): xdr.ScVal | undefined {
  const maybeEntry = entry as {
    val?: unknown;
    xdr?: unknown;
  };

  if (typeof maybeEntry.val === "function") {
    const ledgerEntryData = (maybeEntry.val as () => unknown)() as {
      contractData?: () => { val: () => xdr.ScVal };
    };
    return ledgerEntryData.contractData?.().val();
  }

  if (maybeEntry.val instanceof xdr.ScVal) {
    return maybeEntry.val;
  }

  if (typeof maybeEntry.xdr === "string") {
    return xdr.LedgerEntryData.fromXDR(maybeEntry.xdr, "base64").contractData().val();
  }

  return undefined;
}

export class StellarService {
  private horizonServer: Horizon.Server;
  private sorobanRpc: rpc.Server;
  private networkPassphrase: string;
  private paymentCircuitBreaker: CircuitBreaker;

  constructor() {
    this.horizonServer = horizonServer;
    this.sorobanRpc = sorobanRpcClient;
    this.networkPassphrase = networkPassphrase;
    this.paymentCircuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
  }

  // Temporary backward compatibility methods - to be removed
  public getServer(): Horizon.Server {
    return this.horizonServer;
  }

  public getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  public getPaymentCircuitBreakerState(): string {
    return this.paymentCircuitBreaker.getState();
  }

  public async getContractTradeState(
    contractId: string,
    tradeId: string,
  ): Promise<ContractTradeState> {
    if (!isValidSorobanContractId(contractId)) {
      throw new StellarError({
        code: "STELLAR_INVALID_CONTRACT_ID",
        message: "Invalid Soroban contract ID",
        httpStatus: 404,
        retryable: false,
      });
    }

    if (!/^\d+$/.test(tradeId)) {
      throw new StellarError({
        code: "STELLAR_INVALID_TRADE_ID",
        message: "Invalid trade ID",
        httpStatus: 400,
        retryable: false,
      });
    }

    const tradeKey = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Trade"),
      xdr.ScVal.scvU64(xdr.Uint64.fromString(tradeId)),
    ]);

    try {
      const entry = await this.sorobanRpc.getContractData(
        contractId,
        tradeKey,
        rpc.Durability.Persistent,
      );
      const scVal = extractContractDataScVal(entry);
      if (!scVal) {
        throw new StellarError({
          code: "STELLAR_CONTRACT_DATA_NOT_FOUND",
          message: "Soroban contract trade state was not found",
          httpStatus: 404,
          retryable: false,
        });
      }

      return normalizeTradeState(scValToNative(scVal));
    } catch (error) {
      if (error instanceof StellarError) throw error;
      throw classifyStellarServiceError(error);
    }
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
    } catch (error: unknown) {
      const outcome = classifySubmissionError(error);
      recordTransactionSubmission(
        "build_transaction",
        outcome,
        performance.now() - start,
      );
      const status =
        error !== null &&
        typeof error === "object" &&
        "response" in error &&
        error.response !== null &&
        typeof error.response === "object" &&
        "status" in error.response
          ? (error.response as { status: unknown }).status
          : undefined;
      if (status === 404) {
        appLogger.error({ error, sourceAccount }, "Source account not found");
        throw new Error("Source account does not exist");
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('operation')) {
        appLogger.error({ error }, "Invalid transaction operations");
        throw new Error(`Invalid transaction operations: ${msg}`);
      }
      appLogger.error({ error }, "Failed to build transaction");
      throw new Error(`Failed to build transaction: ${msg || 'Unknown error'}`);
    }
  }

  public async submitTransaction(signedXdr: string): Promise<rpc.Api.SendTransactionResponse> {
    return withCircuitBreaker(async () => {
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

          const response = await this.sorobanRpc.sendTransaction(transaction);

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

          if (response.status === "DUPLICATE") {
            appLogger.warn({
              hash: response.hash ?? "unknown",
              provider: "stellar",
              timestamp: new Date().toISOString(),
            }, "Transaction already submitted (DUPLICATE) — treating as accepted");
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
          }

          if (response.status === "TRY_AGAIN_LATER") {
            const classified = classifyStellarError(new Error("TRY_AGAIN_LATER"));
            recordTransactionSubmission(
              "submit_transaction",
              classified.category === "rate_limited" ? "rpc_error" : classifySubmissionError(new Error("TRY_AGAIN_LATER")),
              performance.now() - start,
            );
            span.setAttributes({
              "stellar.transaction.outcome": "rpc_error",
              "stellar.transaction.hash": response.hash ?? "unknown",
              "stellar.error.category": classified.category,
              "stellar.error.retryable": classified.isRetryable,
            });
            appLogger.error({
              provider: "stellar",
              status: "rate_limited",
              category: classified.category,
              retryable: classified.isRetryable,
              timestamp: new Date().toISOString(),
            }, "Stellar RPC node is temporarily unavailable");
            throw new Error("RPC Error: Stellar node unavailable (TRY_AGAIN_LATER)");
          }

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
                "stellar.error.category": "contract_panic",
                "stellar.error.retryable": false,
              });
              appLogger.error({
                errorMessage,
                provider: "stellar",
                status: "authorization_denied",
                category: "contract_panic",
                retryable: false,
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
              "stellar.error.category": "rpc_error",
              "stellar.error.retryable": false,
            });
            appLogger.error({
              response,
              provider: "stellar",
              status: "authorization_failed",
              category: "rpc_error",
              retryable: false,
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
        } catch (error: unknown) {
          const classified = classifyStellarError(error);
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
            "stellar.error.category": classified.category,
            "stellar.error.retryable": classified.isRetryable,
          });

          const msg = error instanceof Error ? error.message : String(error);

          if (classified.category === "invalid_xdr") {
            appLogger.error({ error, category: classified.category }, "Invalid transaction XDR");
            throw new Error(`Invalid transaction XDR: ${msg}`);
          }

          if (
            classified.category === "rpc_error" ||
            classified.category === "contract_panic" ||
            classified.category === "rate_limited"
          ) {
            throw error;
          }

          if (classified.category === "timeout") {
            appLogger.error(
              { error, provider: "stellar", category: classified.category, timestamp: new Date().toISOString() },
              "Stellar transaction submission timed out",
            );
            throw new Error(
              `Transaction submission failed: Stellar RPC timed out — ${msg || "no details"}`,
            );
          }

          if (classified.category === "connection_refused") {
            appLogger.error(
              { error, provider: "stellar", category: classified.category, timestamp: new Date().toISOString() },
              "Stellar service connection refused",
            );
            throw new Error(
              `Transaction submission failed: Stellar service unavailable — ${msg || "connection refused"}`,
            );
          }

          appLogger.error({ error, category: classified.category }, "Transaction submission failed");
          throw new Error(
            `Transaction submission failed: ${msg || "Unknown error"}`,
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
    }, this.paymentCircuitBreaker);
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

  public async loadAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    try {
      return await this.horizonServer.loadAccount(publicKey);
    } catch (error) {
      throw classifyStellarServiceError(error);
    }
  }

  public async findPaymentPath(params: {
    sourceAssets: any[];
    destinationAsset: any;
    destinationAmount: string;
  }): Promise<any[]> {
    try {
      const result = await this.horizonServer
        .strictReceivePaths(params.sourceAssets, params.destinationAsset, params.destinationAmount)
        .call();
      return result.records;
    } catch (error) {
      throw classifyStellarServiceError(error);
    }
  }

  public buildStrictSendOp(params: {
    sendAsset: any;
    sendAmount: string;
    destination: string;
    destAsset: any;
    destMin: string;
    path?: any[];
  }) {
    return {
      type: 'pathPaymentStrictSend' as const,
      sendAsset: params.sendAsset,
      sendAmount: params.sendAmount,
      destination: params.destination,
      destAsset: params.destAsset,
      destMin: params.destMin,
      path: params.path ?? [],
    };
  }

  public buildStrictReceiveOp(params: {
    sendAsset: any;
    sendMax: string;
    destination: string;
    destAsset: any;
    destAmount: string;
    path?: any[];
  }) {
    return {
      type: 'pathPaymentStrictReceive' as const,
      sendAsset: params.sendAsset,
      sendMax: params.sendMax,
      destination: params.destination,
      destAsset: params.destAsset,
      destAmount: params.destAmount,
      path: params.path ?? [],
    };
  }
}
