import { Horizon, rpc, Networks } from '@stellar/stellar-sdk';
import { env } from './env';

export const networkType: 'testnet' | 'mainnet' = env.STELLAR_NETWORK;

const horizonUrl = networkType === 'testnet'
  ? 'https://horizon-testnet.stellar.org'
  : 'https://horizon.stellar.org';

export const horizonServer = new Horizon.Server(horizonUrl);

const defaultRpcUrl = networkType === 'testnet'
  ? 'https://soroban-testnet.stellar.org'
  : 'https://soroban-rpc.stellar.org';

const rpcUrl = env.STELLAR_RPC_URL || defaultRpcUrl;

if (!env.STELLAR_RPC_URL) {
  console.warn('STELLAR_RPC_URL not set, using default for', networkType);
}

export const sorobanRpcClient = new rpc.Server(rpcUrl);

export const networkPassphrase = env.STELLAR_NETWORK_PASSPHRASE
  ?? (networkType === 'testnet' ? Networks.TESTNET : Networks.PUBLIC);
