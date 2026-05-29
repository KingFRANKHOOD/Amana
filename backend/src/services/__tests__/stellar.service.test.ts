import { StellarService } from '../stellar.service';
import { Horizon, rpc as SorobanRpc, TransactionBuilder } from '@stellar/stellar-sdk';

/**
 * Mock Setup for Stellar SDK Integration Tests
 * 
 * This file sets up comprehensive mocks for the @stellar/stellar-sdk package to enable
 * testing without making real network calls to the Stellar network.
 * 
 * Mocked Components:
 * - Horizon.Server: Mocked for querying ledger data (account balances, transaction history)
 * - SorobanRpc.Server: Mocked for Soroban smart contract interactions
 * - Networks.TESTNET: Testnet network passphrase constant
 * - Networks.PUBLIC: Mainnet network passphrase constant
 * - TransactionBuilder.fromXDR: Mocked for parsing XDR-encoded transactions
 * 
 * Requirements: Validates Requirement 8.1 - Testing with Mocked SDK
 */

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: jest.fn(),
    })),
  },
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      sendTransaction: jest.fn(),
    })),
  },
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
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
  StrKey: {
    isValidEd25519PublicKey: jest.fn((key: string) => /^G[A-Z2-7]{55}$/.test(key)),
    isValidEd25519SecretSeed: jest.fn((key: string) => /^S[A-Z2-7]{55}$/.test(key)),
  },
  BASE_FEE: '100',
  xdr: {},
}));

// Mock the stellar config module
jest.mock('../../config/stellar', () => ({
  horizonServer: {
    loadAccount: jest.fn(),
  },
  sorobanRpcClient: {
    sendTransaction: jest.fn(),
  },
  networkPassphrase: 'Test SDF Network ; September 2015',
}));

describe('StellarService', () => {
  let stellarService: StellarService;
  let mockHorizonServer: jest.Mocked<Horizon.Server>;
  let mockSorobanRpc: jest.Mocked<SorobanRpc.Server>;

  beforeEach(() => {
    // Get the mocked horizon server and soroban rpc
    const config = require('../../config/stellar');
    mockHorizonServer = config.horizonServer;
    mockSorobanRpc = config.sorobanRpcClient;
    
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Create a new instance of StellarService
    stellarService = new StellarService();
  });

  describe('getAccountBalance', () => {
    const validPublicKey = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    it('should return USDC balance for valid address', async () => {
      const mockAccount = {
        balances: [
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '1000.0000000' },
          { asset_type: 'native', balance: '500.0000000' },
        ],
      };
      mockHorizonServer.loadAccount.mockResolvedValue(mockAccount as any);

      const balance = await stellarService.getAccountBalance(validPublicKey, 'USDC');
      
      expect(balance).toBe('1000.0000000');
      expect(mockHorizonServer.loadAccount).toHaveBeenCalledWith(validPublicKey);
    });

    it('should return XLM native balance when assetCode is "XLM"', async () => {
      const mockAccount = {
        balances: [
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '1000.0000000' },
          { asset_type: 'native', balance: '500.0000000' },
        ],
      };
      mockHorizonServer.loadAccount.mockResolvedValue(mockAccount as any);

      const balance = await stellarService.getAccountBalance(validPublicKey, 'XLM');
      
      expect(balance).toBe('500.0000000');
      expect(mockHorizonServer.loadAccount).toHaveBeenCalledWith(validPublicKey);
    });

    it('should default to USDC when no assetCode is provided', async () => {
      const mockAccount = {
        balances: [
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '2500.5000000' },
        ],
      };
      mockHorizonServer.loadAccount.mockResolvedValue(mockAccount as any);

      const balance = await stellarService.getAccountBalance(validPublicKey);
      
      expect(balance).toBe('2500.5000000');
    });

    it('should return "0" when asset is not found in account balances', async () => {
      const mockAccount = {
        balances: [
          { asset_type: 'native', balance: '500.0000000' },
        ],
      };
      mockHorizonServer.loadAccount.mockResolvedValue(mockAccount as any);

      const balance = await stellarService.getAccountBalance(validPublicKey, 'USDC');
      
      expect(balance).toBe('0');
    });

    it('should return "0" when account has no balances', async () => {
      const mockAccount = {
        balances: [],
      };
      mockHorizonServer.loadAccount.mockResolvedValue(mockAccount as any);

      const balance = await stellarService.getAccountBalance(validPublicKey, 'USDC');
      
      expect(balance).toBe('0');
    });

    it('should throw error when account does not exist', async () => {
      const error = new Error('Account not found');
      mockHorizonServer.loadAccount.mockRejectedValue(error);

      await expect(stellarService.getAccountBalance(validPublicKey, 'USDC'))
        .rejects.toThrow('Unable to fetch balance');
    });

    it('should throw error when network request fails', async () => {
      const error = new Error('Network timeout');
      mockHorizonServer.loadAccount.mockRejectedValue(error);

      await expect(stellarService.getAccountBalance(validPublicKey, 'USDC'))
        .rejects.toThrow('Unable to fetch balance');
    });

    it('should log error details when balance fetch fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Network failure');
      mockHorizonServer.loadAccount.mockRejectedValue(error);

      await expect(stellarService.getAccountBalance(validPublicKey, 'USDC'))
        .rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to get balance for ${validPublicKey}:`,
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('submitTransaction', () => {
    const validSignedXdr = 'AAAAAgAAAABexSIg06FtXzmFBQQtHZsrnyWxUzmthkBEhs/ktoeVYgAAAGQADKI4AAAABAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABAAAAAF7FIiDToW1fOYUFBC0dmyufJbFTOa2GQESG';
    
    // Mock TransactionBuilder.fromXDR
    beforeEach(() => {
      jest.spyOn(TransactionBuilder, 'fromXDR').mockReturnValue({
        hash: () => Buffer.from('mockhash'),
      } as any);
    });

    it('should successfully submit transaction and return response', async () => {
      const mockResponse: SorobanRpc.Api.SendTransactionResponse = {
        status: 'PENDING',
        hash: 'abc123def456',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      const result = await stellarService.submitTransaction(validSignedXdr);

      expect(result).toEqual(mockResponse);
      expect(mockSorobanRpc.sendTransaction).toHaveBeenCalledTimes(1);
      expect(TransactionBuilder.fromXDR).toHaveBeenCalledWith(
        validSignedXdr,
        'Test SDF Network ; September 2015'
      );
    });

    it('should log transaction hash on successful submission', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const mockResponse: SorobanRpc.Api.SendTransactionResponse = {
        status: 'PENDING',
        hash: 'transaction-hash-123',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await stellarService.submitTransaction(validSignedXdr);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Transaction submitted with hash: transaction-hash-123'
      );

      consoleLogSpy.mockRestore();
    });

    it('should throw RPC Error when response status is ERROR without errorResult', async () => {
      const mockResponse: any = {
        status: 'ERROR',
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow('RPC Error: ERROR');
    });

    it('should throw Contract Panic when response has errorResult', async () => {
      const mockResponse: any = {
        status: 'ERROR',
        errorResult: { message: 'Insufficient balance' },
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow('Contract Panic: {"message":"Insufficient balance"}');
    });

    it('should differentiate between RPC errors and contract panics', async () => {
      // Test RPC error
      const rpcErrorResponse: any = {
        status: 'ERROR',
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(rpcErrorResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow(/^RPC Error:/);

      // Test contract panic
      const contractPanicResponse: any = {
        status: 'ERROR',
        errorResult: 'Contract execution failed',
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(contractPanicResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow(/^Contract Panic:/);
    });

    it('should throw error for invalid XDR format', async () => {
      const invalidXdr = 'invalid-xdr-string';
      (TransactionBuilder.fromXDR as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid XDR format');
      });

      await expect(stellarService.submitTransaction(invalidXdr))
        .rejects.toThrow('Invalid transaction XDR: Invalid XDR format');
    });

    it('should log error details when RPC error occurs', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockResponse: any = {
        status: 'ERROR',
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith('RPC Error:', mockResponse);

      consoleErrorSpy.mockRestore();
    });

    it('should log error details when contract panic occurs', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockResponse: any = {
        status: 'ERROR',
        errorResult: { message: 'Contract failed' },
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Contract Panic:', '{"message":"Contract failed"}');

      consoleErrorSpy.mockRestore();
    });

    it('should handle network timeout errors', async () => {
      const networkError = new Error('Network timeout');
      mockSorobanRpc.sendTransaction.mockRejectedValue(networkError);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow('Transaction submission failed: Network timeout');
    });

    it('should parse contract error from string errorResult', async () => {
      const mockResponse: any = {
        status: 'ERROR',
        errorResult: 'String error message',
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow('Contract Panic: String error message');
    });

    it('should parse contract error from object with message property', async () => {
      const mockResponse: any = {
        status: 'ERROR',
        errorResult: { message: 'Object error message' },
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow('Contract Panic: {"message":"Object error message"}');
    });

    it('should handle complex errorResult objects', async () => {
      const mockResponse: any = {
        status: 'ERROR',
        errorResult: { code: 500, details: 'Complex error' },
        hash: 'error-hash',
        latestLedger: 12345,
        latestLedgerCloseTime: 1234567890,
      };
      mockSorobanRpc.sendTransaction.mockResolvedValue(mockResponse);

      await expect(stellarService.submitTransaction(validSignedXdr))
        .rejects.toThrow('Contract Panic:');
    });
  });
});
