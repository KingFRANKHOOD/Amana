import { useWalletStore } from '../stores/walletStore';
import * as freighterApi from '@stellar/freighter-api';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

jest.mock('@stellar/freighter-api');

describe('Wallet Store', () => {
  beforeEach(() => {
    localStorageMock.clear();
    useWalletStore.setState({
      publicKey: null,
      network: 'public',
      balances: {},
      isConnected: false,
      isConnecting: false,
    });
    jest.clearAllMocks();
    (freighterApi.isConnected as jest.Mock).mockClear();
    (freighterApi.isAllowed as jest.Mock).mockClear();
    (freighterApi.getAddress as jest.Mock).mockClear();
  });

  describe('Initial State', () => {
    it('should have correct default state', () => {
      const state = useWalletStore.getState();
      expect(state.publicKey).toBeNull();
      expect(state.network).toBe('public');
      expect(state.balances).toEqual({});
      expect(state.isConnected).toBe(false);
      expect(state.isConnecting).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect wallet and update state', () => {
      const store = useWalletStore.getState();
      store.connect('GC1234...', 'testnet');

      const state = useWalletStore.getState();
      expect(state.publicKey).toBe('GC1234...');
      expect(state.network).toBe('testnet');
      expect(state.isConnected).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should clear connection and reset state', () => {
      useWalletStore.setState({
        publicKey: 'GC1234...',
        network: 'testnet',
        balances: { XLM: '100' },
        isConnected: true,
      });

      const store = useWalletStore.getState();
      store.disconnect();

      const state = useWalletStore.getState();
      expect(state.publicKey).toBeNull();
      expect(state.network).toBe('public');
      expect(state.balances).toEqual({});
      expect(state.isConnected).toBe(false);
    });
  });

  describe('setBalances', () => {
    it('should update token balances', () => {
      const store = useWalletStore.getState();
      store.setBalances({ XLM: '50', USDC: '12.5' });

      const state = useWalletStore.getState();
      expect(state.balances).toEqual({ XLM: '50', USDC: '12.5' });
    });
  });

  describe('reset', () => {
    it('should reset all state values', () => {
      useWalletStore.setState({
        publicKey: 'GC1234...',
        network: 'testnet',
        balances: { XLM: '100' },
        isConnected: true,
        isConnecting: true,
      });

      const store = useWalletStore.getState();
      store.reset();

      const state = useWalletStore.getState();
      expect(state.publicKey).toBeNull();
      expect(state.network).toBe('public');
      expect(state.balances).toEqual({});
      expect(state.isConnected).toBe(false);
      expect(state.isConnecting).toBe(false);
    });
  });

  describe('onRehydrateStorage', () => {
    it('should verify persisted wallet state with Freighter on rehydration', async () => {
      const testAddress = 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456';

      (freighterApi.isConnected as jest.Mock).mockResolvedValue({
        isConnected: true,
      });
      (freighterApi.isAllowed as jest.Mock).mockResolvedValue({
        isAllowed: true,
      });
      (freighterApi.getAddress as jest.Mock).mockResolvedValue({
        address: testAddress,
      });

      // Simulate hydration with a persisted publicKey
      useWalletStore.setState({ publicKey: testAddress, isConnected: false });

      // Wait a bit for the async verification to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = useWalletStore.getState();
      // After verification passes, should be marked as connected
      expect(state.isConnected).toBe(true);
    });

    it('should clear wallet state if Freighter is disconnected on rehydration', async () => {
      const testAddress = 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456';

      // Freighter reports not connected
      (freighterApi.isConnected as jest.Mock).mockResolvedValue({
        isConnected: false,
      });
      (freighterApi.isAllowed as jest.Mock).mockResolvedValue({
        isAllowed: true,
      });

      // Simulate hydration with a persisted publicKey
      useWalletStore.setState({ publicKey: testAddress, isConnected: false });

      // Wait for async verification to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = useWalletStore.getState();
      expect(state.publicKey).toBeNull();
      expect(state.isConnected).toBe(false);
    });

    it('should clear wallet state if a different address is now connected on rehydration', async () => {
      const oldAddress = 'GABCDEF1111111111111111111111111111111111111111111111111111111';
      const newAddress = 'GABCDEF2222222222222222222222222222222222222222222222222222222';

      (freighterApi.isConnected as jest.Mock).mockResolvedValue({
        isConnected: true,
      });
      (freighterApi.isAllowed as jest.Mock).mockResolvedValue({
        isAllowed: true,
      });
      // Freighter now returns a different address
      (freighterApi.getAddress as jest.Mock).mockResolvedValue({
        address: newAddress,
      });

      // Simulate hydration with the old persisted publicKey
      useWalletStore.setState({ publicKey: oldAddress, isConnected: false });

      // Wait for async verification to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = useWalletStore.getState();
      // Should clear the old address since a different one is now connected
      expect(state.publicKey).toBeNull();
      expect(state.isConnected).toBe(false);
    });

    it('should clear wallet state if Freighter verification throws', async () => {
      const testAddress = 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456';

      // Simulate Freighter API error
      (freighterApi.isConnected as jest.Mock).mockRejectedValue(
        new Error('Freighter connection failed')
      );

      // Simulate hydration with a persisted publicKey
      useWalletStore.setState({ publicKey: testAddress, isConnected: false });

      // Wait for async verification to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = useWalletStore.getState();
      expect(state.publicKey).toBeNull();
      expect(state.isConnected).toBe(false);
    });
  });
});
