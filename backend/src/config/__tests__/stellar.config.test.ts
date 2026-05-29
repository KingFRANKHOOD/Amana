import { Networks } from '@stellar/stellar-sdk';

/**
 * Mock Setup for Stellar Configuration Tests
 * 
 * This file sets up comprehensive mocks for the @stellar/stellar-sdk package to enable
 * testing the configuration module without making real network calls.
 * 
 * Mocked Components:
 * - Horizon.Server: Mocked for Horizon client initialization
 * - SorobanRpc.Server: Mocked for Soroban RPC client initialization
 * - Networks.TESTNET: Testnet network passphrase constant
 * - Networks.PUBLIC: Mainnet network passphrase constant
 * - TransactionBuilder.fromXDR: Mocked for XDR parsing tests
 * 
 * Requirements: Validates Requirement 8.1 - Testing with Mocked SDK
 */

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation((url: string) => ({
      url,
      loadAccount: jest.fn(),
    })),
  },
  SorobanRpc: {
    Server: jest.fn().mockImplementation((url: string) => ({
      url,
      sendTransaction: jest.fn(),
    })),
  },
  rpc: {
    Server: jest.fn().mockImplementation((url: string) => ({
      url,
      sendTransaction: jest.fn(),
    })),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  TransactionBuilder: {
    fromXDR: jest.fn(),
  },
}));

describe('Stellar Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should default to testnet when STELLAR_NETWORK is not set', () => {
    delete process.env.STELLAR_NETWORK;
    
    const config = require('../stellar');
    
    expect(config.networkType).toBe('testnet');
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
    expect(config.horizonServer).toBeDefined();
    expect(config.sorobanRpcClient).toBeDefined();
  });

  it('should use testnet when STELLAR_NETWORK is "testnet"', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    
    const config = require('../stellar');
    
    expect(config.networkType).toBe('testnet');
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('should use mainnet when STELLAR_NETWORK is "mainnet"', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    
    const config = require('../stellar');
    
    expect(config.networkType).toBe('mainnet');
    expect(config.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it('should export all required properties', () => {
    const config = require('../stellar');
    
    expect(config).toHaveProperty('horizonServer');
    expect(config).toHaveProperty('sorobanRpcClient');
    expect(config).toHaveProperty('networkPassphrase');
    expect(config).toHaveProperty('networkType');
  });

  it('should handle invalid network values by defaulting to testnet', () => {
    process.env.STELLAR_NETWORK = 'invalid';
    
    const config = require('../stellar');
    
    expect(config.networkType).toBe('testnet');
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
  });
});
