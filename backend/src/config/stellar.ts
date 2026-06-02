import { Horizon, rpc, Networks } from '@stellar/stellar-sdk';
import { env } from './env';

export const USDC_ISSUER_MAINNET = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
// Testnet USDC issuer — override via USDC_ISSUER env var if a specific testnet asset is needed.
export const USDC_ISSUER_TESTNET =
  process.env.USDC_ISSUER ?? "GDDD3FRCH55BSYNKISYY242HQNIBOH35CQP42NSJABR62XK2JOV5MED6";

// Read network configuration from environment
const stellarNetwork = process.env.STELLAR_NETWORK || 'testnet';
const stellarRpcUrl = process.env.STELLAR_RPC_URL || '';

const networkType = stellarNetwork as 'testnet' | 'mainnet';
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
