import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type { TradeRecord } from "../types/trade";

type RpcServerFactory = (rpcUrl: string) => rpc.Server;

let serverFactory: RpcServerFactory = (rpcUrl: string) =>
  new rpc.Server(rpcUrl, { allowHttp: true });

/** Vitest-only hook to avoid live Soroban RPC in unit tests. */
export function __setRpcServerFactoryForTests(factory: RpcServerFactory): void {
  serverFactory = factory;
}

export function __resetRpcServerFactoryForTests(): void {
  serverFactory = (rpcUrl: string) => new rpc.Server(rpcUrl, { allowHttp: true });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function networkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.FUTURENET;
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

  const rpcUrl = requireEnv("SOROBAN_RPC_URL");
  const contractId = requireEnv("AMANA_ESCROW_CONTRACT_ID");
  const server = serverFactory(rpcUrl);
  const account = await server.getAccount(sourceAccountId);
  const contract = new Contract(contractId);
  const op = contract.call(
    "confirm_delivery",
    xdr.ScVal.scvU64(xdr.Uint64.fromString(trade.chainTradeId)),
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
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

  const rpcUrl = requireEnv("SOROBAN_RPC_URL");
  const contractId = requireEnv("AMANA_ESCROW_CONTRACT_ID");
  const server = serverFactory(rpcUrl);
  const account = await server.getAccount(sourceAccountId);
  const contract = new Contract(contractId);
  const op = contract.call(
    "release_funds",
    xdr.ScVal.scvU64(xdr.Uint64.fromString(trade.chainTradeId)),
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}
