import { Trade } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import type { TradeRecord } from "../types/trade";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_TIMEOUT_SECONDS = 300;
const USDC_DECIMALS = 7n;
const USDC_BASE = 10n ** USDC_DECIMALS;

type RpcServerFactory = (rpcUrl: string) => StellarSdk.rpc.Server;

let serverFactory: RpcServerFactory = (rpcUrl: string) =>
  new StellarSdk.rpc.Server(rpcUrl, { allowHttp: true });

export interface BuildCreateTradeTxInput {
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
}

export interface BuildCreateTradeTxResult {
  tradeId: string;
  unsignedXdr: string;
}

export interface BuildDepositTxResult {
  unsignedXdr: string;
}
/** Vitest-only hook to avoid live Soroban RPC in unit tests. */
export function __setRpcServerFactoryForTests(factory: RpcServerFactory): void {
  serverFactory = factory;
}

export function __resetRpcServerFactoryForTests(): void {
  serverFactory = (rpcUrl: string) =>
    new StellarSdk.rpc.Server(rpcUrl, { allowHttp: true });
}

function requireEnv(name: string, fallback = ""): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveNetworkPassphrase(
  configuredPassphrase?: string,
  configuredNetwork?: string,
): string {
  if (configuredPassphrase) {
    return configuredPassphrase;
  }

  switch (configuredNetwork?.toUpperCase()) {
    case "PUBLIC":
      return StellarSdk.Networks.PUBLIC;
    case "FUTURENET":
      return StellarSdk.Networks.FUTURENET;
    default:
      return StellarSdk.Networks.TESTNET;
  }
}

function getRpcServer(rpcUrl: string): StellarSdk.rpc.Server {
  return serverFactory(rpcUrl);
}

function getEscrowContractId(): string {
  return requireEnv("AMANA_ESCROW_CONTRACT_ID", process.env.CONTRACT_ID || "");
}

function getRpcUrl(): string {
  return process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL || DEFAULT_RPC_URL;
}

function getNetworkPassphrase(): string {
  return resolveNetworkPassphrase(
    process.env.STELLAR_NETWORK_PASSPHRASE,
    process.env.STELLAR_NETWORK,
  );
}

/**
 * Builds an unsigned Soroban transaction XDR (base64) for `confirm_delivery(trade_id)`.
 * Caller should sign and submit via a wallet / RPC.
 */
export async function buildConfirmDeliveryTx(
  trade: TradeRecord,
  sourceAccountId: string,
): Promise<string> {
  if (trade.status !== "FUNDED") {
    throw new Error(
      `Trade must be FUNDED before confirm_delivery (current: ${trade.status})`,
    );
  }

  const server = getRpcServer(getRpcUrl());
  const account = await server.getAccount(sourceAccountId);
  const contract = new StellarSdk.Contract(getEscrowContractId());
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      contract.call(
        "confirm_delivery",
        StellarSdk.xdr.ScVal.scvU64(
          StellarSdk.xdr.Uint64.fromString(trade.chainTradeId),
        ),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  return prepared.toXDR();
}

/**
 * Builds an unsigned Soroban transaction XDR (base64) for `release_funds(trade_id)`.
 */
export async function buildReleaseFundsTx(
  trade: TradeRecord,
  sourceAccountId: string,
): Promise<string> {
  if (trade.status !== "DELIVERED") {
    throw new Error(
      `Trade must be DELIVERED before release_funds (current: ${trade.status})`,
    );
  }

  const server = getRpcServer(getRpcUrl());
  const account = await server.getAccount(sourceAccountId);
  const contract = new StellarSdk.Contract(getEscrowContractId());
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      contract.call(
        "release_funds",
        StellarSdk.xdr.ScVal.scvU64(
          StellarSdk.xdr.Uint64.fromString(trade.chainTradeId),
        ),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  return prepared.toXDR();
}

export class ContractService {
  private readonly rpcServer: StellarSdk.rpc.Server;
  private readonly contractId: string;
  private readonly usdcContractId: string;
  private readonly networkPassphrase: string;

  constructor(
    rpcUrl: string = getRpcUrl(),
    contractId: string = getEscrowContractId(),
    usdcContractId: string = process.env.USDC_CONTRACT_ID || "",
    networkPassphrase: string = getNetworkPassphrase(),
  ) {
    this.rpcServer = getRpcServer(rpcUrl);
    this.contractId = contractId;
    this.usdcContractId = usdcContractId;
    this.networkPassphrase = networkPassphrase;
  }

  public async buildCreateTradeTx(
    input: BuildCreateTradeTxInput,
  ): Promise<BuildCreateTradeTxResult> {
    if (!this.contractId) {
      throw new Error("CONTRACT_ID is not configured");
    }

    const account = await this.rpcServer.getAccount(input.buyerAddress);
    const contract = new StellarSdk.Contract(this.contractId);
    const amount = this.toContractAmount(input.amountUsdc);

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "create_trade",
          StellarSdk.Address.fromString(input.buyerAddress).toScVal(),
          StellarSdk.Address.fromString(input.sellerAddress).toScVal(),
          StellarSdk.nativeToScVal(amount, { type: "i128" }),
        ),
      )
      .setTimeout(DEFAULT_TIMEOUT_SECONDS)
      .build();

    const simulation = await this.rpcServer.simulateTransaction(transaction);
    const tradeId = this.extractTradeId(simulation);
    const preparedTransaction =
      await this.rpcServer.prepareTransaction(transaction);

    return {
      tradeId,
      unsignedXdr: preparedTransaction.toXDR(),
    };
  }

  public async buildDepositTx(
    trade: Pick<Trade, "tradeId" | "buyer" | "amountUsdc">,
  ): Promise<BuildDepositTxResult> {
    if (!this.contractId) {
      throw new Error("CONTRACT_ID is not configured");
    }

    if (!this.usdcContractId) {
      throw new Error("USDC_CONTRACT_ID is not configured");
    }

    const account = await this.rpcServer.getAccount(trade.buyer);
    const contract = new StellarSdk.Contract(this.contractId);

    // The current escrow contract pulls the buyer's USDC during `deposit()`,
    // so the prepared Soroban transaction is a single deposit invocation.
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "deposit",
          StellarSdk.nativeToScVal(BigInt(trade.tradeId), { type: "u64" }),
        ),
      )
      .setTimeout(DEFAULT_TIMEOUT_SECONDS)
      .build();

    const preparedTransaction =
      await this.rpcServer.prepareTransaction(transaction);

    return {
      unsignedXdr: preparedTransaction.toXDR(),
    };
  }
  /**
   * Builds an unsigned Soroban XDR for `submit_manifest(trade_id, driver_name_hash, driver_id_hash)`.
   * Hashes are hex strings (SHA-256) of the sensitive fields.
   */
  public async buildSubmitManifestTx(input: {
    tradeId: string;
    sellerAddress: string;
    driverNameHash: string;
    driverIdHash: string;
  }): Promise<{ unsignedXdr: string }> {
    if (!this.contractId) throw new Error("CONTRACT_ID is not configured");

    const account = await this.rpcServer.getAccount(input.sellerAddress);
    const contract = new StellarSdk.Contract(this.contractId);

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "submit_manifest",
          StellarSdk.nativeToScVal(BigInt(input.tradeId), { type: "u64" }),
          StellarSdk.nativeToScVal(input.driverNameHash, { type: "string" }),
          StellarSdk.nativeToScVal(input.driverIdHash, { type: "string" }),
        ),
      )
      .setTimeout(DEFAULT_TIMEOUT_SECONDS)
      .build();

    const prepared = await this.rpcServer.prepareTransaction(transaction);
    return { unsignedXdr: prepared.toXDR() };
  }

  private toContractAmount(amountUsdc: string): bigint {
    const [wholePart, fractionPart = ""] = amountUsdc.split(".");
    const paddedFraction = `${fractionPart}0000000`.slice(
      0,
      Number(USDC_DECIMALS),
    );

    return BigInt(wholePart) * USDC_BASE + BigInt(paddedFraction);
  }

  private extractTradeId(
    simulation: StellarSdk.rpc.Api.SimulateTransactionResponse,
  ): string {
    if ("error" in simulation && typeof simulation.error === "string") {
      throw new Error(
        `Failed to simulate create_trade transaction: ${simulation.error}`,
      );
    }

    if (!("result" in simulation) || !simulation.result) {
      throw new Error("Trade simulation did not return a tradeId");
    }

    return String(StellarSdk.scValToNative(simulation.result.retval));
  }
}
