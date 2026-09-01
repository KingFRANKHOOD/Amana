import { Text, AppState } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { AuthenticationGate } from '../AuthenticationGate';
import * as biometric from '../../services/biometric.service';

jest.mock('../../services/biometric.service', () => ({
  isBiometricEnabled: jest.fn(),
  authenticateAppUnlock: jest.fn(),
}));

describe('AuthenticationGate', () => {
  let addEventListenerSpy: jest.SpyInstance;
  let listeners: Array<(state: string) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    listeners = [];
    addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_event: string, cb: (state: string) => void) => {
        listeners.push(cb);
        return { remove: jest.fn() } as any;
      }) as any);
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
  });

  it('renders children when not authenticated', async () => {
    (biometric.isBiometricEnabled as jest.Mock).mockResolvedValue(false);
    const { getByText } = render(
      <AuthenticationGate authenticated={false}><Text>child-content</Text></AuthenticationGate>
    );
    await waitFor(() => expect(getByText('child-content')).toBeTruthy());
  });

  it('renders children when authenticated but biometrics disabled', async () => {
    (biometric.isBiometricEnabled as jest.Mock).mockResolvedValue(false);
    const { getByText } = render(
      <AuthenticationGate authenticated={true}><Text>child-content</Text></AuthenticationGate>
    );
    await waitFor(() => expect(getByText('child-content')).toBeTruthy());
  });

  it('shows locked screen when biometric auth fails', async () => {
    (biometric.isBiometricEnabled as jest.Mock).mockResolvedValue(true);
    (biometric.authenticateAppUnlock as jest.Mock).mockResolvedValue(false);
    const { getByText } = render(
      <AuthenticationGate authenticated={true}><Text>child-content</Text></AuthenticationGate>
    );
    await waitFor(() => expect(getByText('Amana Locked')).toBeTruthy());
  });

  it('unlocks and shows children when auth succeeds', async () => {
    (biometric.isBiometricEnabled as jest.Mock).mockResolvedValue(true);
    (biometric.authenticateAppUnlock as jest.Mock).mockResolvedValue(true);
    const { getByText } = render(
      <AuthenticationGate authenticated={true}><Text>child-content</Text></AuthenticationGate>
    );
    await waitFor(() => expect(getByText('child-content')).toBeTruthy());
  });

  it('unlocks on app state change back to active', async () => {
    (biometric.isBiometricEnabled as jest.Mock).mockResolvedValue(true);
    (biometric.authenticateAppUnlock as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { getByText } = render(
      <AuthenticationGate authenticated={true}><Text>child-content</Text></AuthenticationGate>
    );
    await waitFor(() => expect(getByText('Amana Locked')).toBeTruthy());

    act(() => {
      listeners.forEach((cb) => cb('active'));
    });

    await waitFor(() => expect(getByText('child-content')).toBeTruthy());
  });
});
