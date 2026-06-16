import { useAuthStore } from '../../stores/authStore';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const SecureStore = jest.requireMock('expo-secure-store');

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ token: null, walletAddress: null, isLoading: true });
});

describe('authStore', () => {
  it('setToken persists token to SecureStore and updates state', async () => {
    await useAuthStore.getState().setToken('tok_abc');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('amana_token', 'tok_abc');
    expect(useAuthStore.getState().token).toBe('tok_abc');
  });

  it('getToken reads from SecureStore and updates state', async () => {
    SecureStore.getItemAsync.mockResolvedValue('tok_xyz');

    const result = await useAuthStore.getState().getToken();

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('amana_token');
    expect(result).toBe('tok_xyz');
    expect(useAuthStore.getState().token).toBe('tok_xyz');
  });

  it('getToken returns null when SecureStore throws', async () => {
    SecureStore.getItemAsync.mockRejectedValue(new Error('read error'));

    const result = await useAuthStore.getState().getToken();

    expect(result).toBeNull();
  });

  it('clearAuth removes token from SecureStore and resets state', async () => {
    useAuthStore.setState({ token: 'tok_abc', walletAddress: '0xabc' });

    await useAuthStore.getState().clearAuth();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('amana_token');
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().walletAddress).toBeNull();
  });
});
