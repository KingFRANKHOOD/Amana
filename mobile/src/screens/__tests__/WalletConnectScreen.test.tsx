import { render, fireEvent, waitFor } from '@testing-library/react-native';
import WalletConnectScreen from '../WalletConnectScreen';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/authStore';

jest.mock('../../api/auth', () => ({
  authApi: {
    generateChallenge: jest.fn(),
    verifyChallenge: jest.fn(),
    refreshToken: jest.fn(),
  },
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

describe('WalletConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      token: null,
      walletAddress: null,
      isLoading: false,
    });
  });

  it('renders the connect wallet button', () => {
    const { getByText } = render(<WalletConnectScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    expect(getByText('Amana')).toBeTruthy();
    expect(getByText('Connect Wallet')).toBeTruthy();
  });

  it('validates the entered wallet address', async () => {
    const Alert = require('react-native').Alert;
    const alertSpy = jest.spyOn(Alert, 'prompt').mockImplementation((...args: any[]) => {
      const cb = args[2] as (v: string) => void;
      cb('invalid-address');
    });
    const alertAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<WalletConnectScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    fireEvent.press(getByText('Connect Wallet'));
    await waitFor(() => {
      expect(alertAlert).toHaveBeenCalledWith('Invalid address', expect.any(String));
    });

    alertSpy.mockRestore();
    alertAlert.mockRestore();
  });

  it('connects successfully with a valid address', async () => {
    const validAddress = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';
    (authApi.generateChallenge as jest.Mock).mockResolvedValue({ challenge: 'challenge-1' });
    (authApi.verifyChallenge as jest.Mock).mockResolvedValue({ token: 'tok_123' });

    const Alert = require('react-native').Alert;
    const promptSpy = jest.spyOn(Alert, 'prompt').mockImplementation((...args: any[]) => {
      const cb = args[2] as (v: string) => void;
      cb(validAddress);
    });

    const { getByText } = render(<WalletConnectScreen navigation={mockNavigation as any} route={{ params: {} } as any} />);
    fireEvent.press(getByText('Connect Wallet'));

    await waitFor(() => {
      expect(authApi.generateChallenge).toHaveBeenCalledWith(validAddress);
      expect(authApi.verifyChallenge).toHaveBeenCalledWith(validAddress, 'challenge-1');
      expect(useAuthStore.getState().token).toBe('tok_123');
      expect(useAuthStore.getState().walletAddress).toBe(validAddress);
      expect(mockNavigation.replace).toHaveBeenCalledWith('TradeList');
    });

    promptSpy.mockRestore();
  });
});
