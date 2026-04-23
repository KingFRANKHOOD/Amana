import { Horizon, rpc, Networks } from '@stellar/stellar-sdk';

// Read network configuration from environment
const stellarNetwork = process.env.STELLAR_NETWORK || 'testnet';
const stellarRpcUrl = process.env.STELLAR_RPC_URL || '';

// Validate network type
export const networkType: 'testnet' | 'mainnet' = 
  stellarNetwork === 'mainnet' ? 'mainnet' : 'testnet';

// Configure Horizon server based on network
const horizonUrl = networkType === 'testnet'
  ? 'https://horizon-testnet.stellar.org'
  : 'https://horizon.stellar.org';

export const horizonServer = new Horizon.Server(horizonUrl);

// Configure Soroban RPC client using environment variable
if (!stellarRpcUrl) {
  console.warn('STELLAR_RPC_URL not set, using default for', networkType);
}

const defaultRpcUrl = networkType === 'testnet'
  ? 'https://soroban-testnet.stellar.org'
  : 'https://soroban-rpc.stellar.org';

export const sorobanRpcClient = new rpc.Server(
  stellarRpcUrl || defaultRpcUrl
);

// Set network passphrase based on network type
export const networkPassphrase = networkType === 'testnet'
  ? Networks.TESTNET
  : Networks.PUBLIC;
