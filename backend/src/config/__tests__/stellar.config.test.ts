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

  it('should initialize primary and fallback RPC endpoints from env', () => {
    process.env.STELLAR_RPC_URL = 'https://primary-rpc.stellar.org';
    process.env.STELLAR_RPC_FALLBACK_URLS = 'https://fallback-1.stellar.org, https://fallback-2.stellar.org';

    const config = require('../stellar');
    const manager = config.stellarRpcManager;

    expect(manager.getPrimaryRpcUrl()).toBe('https://primary-rpc.stellar.org');
    expect(manager.getActiveRpcUrl()).toBe('https://primary-rpc.stellar.org');
    expect(manager.getFallbackRpcUrls()).toEqual([
      'https://fallback-1.stellar.org',
      'https://fallback-2.stellar.org',
    ]);
  });

  it('should automatically failover to fallback RPC node when primary fails', async () => {
    process.env.STELLAR_RPC_URL = 'https://primary-rpc.stellar.org';
    process.env.STELLAR_RPC_FALLBACK_URLS = 'https://fallback-1.stellar.org';

    const config = require('../stellar');
    const manager = config.stellarRpcManager;

    let failoverEvent: { from: string; to: string; reason: string } | null = null;
    manager.onFailover((from: string, to: string, reason: string) => {
      failoverEvent = { from, to, reason };
    });

    const result = await manager.executeRpcWithFallback(async (_client: any, url: string) => {
      if (url === 'https://primary-rpc.stellar.org') {
        throw new Error('ETIMEDOUT: connection timed out');
      }
      return { success: true, answeredBy: url };
    });

    expect(result).toEqual({ success: true, answeredBy: 'https://fallback-1.stellar.org' });
    expect(manager.getActiveRpcUrl()).toBe('https://fallback-1.stellar.org');
    expect(failoverEvent).toEqual(
      expect.objectContaining({
        from: 'https://primary-rpc.stellar.org',
        to: 'https://fallback-1.stellar.org',
      }),
    );
  });

  it('should perform network health check and report healthy status', async () => {
    process.env.STELLAR_RPC_URL = 'https://primary-rpc.stellar.org';

    const config = require('../stellar');
    const manager = config.stellarRpcManager;

    // Mock getLatestLedger on RPC client
    const activeClient = manager.getActiveRpcClient();
    activeClient.getLatestLedger = jest.fn().mockResolvedValue({ sequence: 12345 });

    const health = await manager.checkNetworkHealth();

    expect(health.status).toBe('healthy');
    expect(health.network).toBe('testnet');
    expect(health.activeRpcUrl).toBe('https://primary-rpc.stellar.org');
    expect(health.nodes).toHaveLength(1);
    expect(health.nodes[0]?.status).toBe('healthy');
    expect(health.nodes[0]?.latestLedger).toBe(12345);
  });

  it('should report degraded status when operating on fallback node', async () => {
    process.env.STELLAR_RPC_URL = 'https://primary-rpc.stellar.org';
    process.env.STELLAR_RPC_FALLBACK_URLS = 'https://fallback-1.stellar.org';

    const config = require('../stellar');
    const manager = config.stellarRpcManager;

    // Fail primary node check, succeed fallback
    const rpcNodes = (manager as any).rpcNodes;
    rpcNodes[0].client.getLatestLedger = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    rpcNodes[1].client.getLatestLedger = jest.fn().mockResolvedValue({ sequence: 99999 });

    const health = await manager.checkNetworkHealth();

    expect(health.status).toBe('degraded');
    expect(health.nodes[0]?.status).toBe('unhealthy');
    expect(health.nodes[1]?.status).toBe('healthy');
  });

  it('should report unhealthy status when all RPC nodes fail', async () => {
    process.env.STELLAR_RPC_URL = 'https://primary-rpc.stellar.org';
    process.env.STELLAR_RPC_FALLBACK_URLS = 'https://fallback-1.stellar.org';

    const config = require('../stellar');
    const manager = config.stellarRpcManager;

    const rpcNodes = (manager as any).rpcNodes;
    rpcNodes[0].client.getLatestLedger = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    rpcNodes[1].client.getLatestLedger = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const health = await manager.checkNetworkHealth();

    expect(health.status).toBe('unhealthy');
    expect(health.nodes.every((n: any) => n.status === 'unhealthy')).toBe(true);
  });
});
