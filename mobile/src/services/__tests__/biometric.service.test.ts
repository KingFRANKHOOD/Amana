import {
  getBiometricCapability,
  isBiometricEnabled,
  setBiometricEnabled,
  canUseBiometricAuth,
  authenticateWithBiometrics,
  authenticateAppUnlock,
  authorizeSensitiveAction,
  isWithinUnlockGracePeriod,
} from '../biometric.service';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
    __store: store,
  };
});

describe('biometric.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const store = (SecureStore as any).__store;
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('getBiometricCapability returns capability', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock).mockResolvedValue([1]);
    const result = await getBiometricCapability();
    expect(result).toEqual({ available: true, enrolled: true, types: [1] });
  });

  it('isBiometricEnabled is false by default', async () => {
    expect(await isBiometricEnabled()).toBe(false);
  });

  it('setBiometricEnabled stores the preference', async () => {
    await setBiometricEnabled(true);
    expect(await isBiometricEnabled()).toBe(true);
    await setBiometricEnabled(false);
    expect(await isBiometricEnabled()).toBe(false);
  });

  it('canUseBiometricAuth returns true when available and enrolled', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    expect(await canUseBiometricAuth()).toBe(true);
  });

  it('canUseBiometricAuth returns false when not enrolled', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
    expect(await canUseBiometricAuth()).toBe(false);
  });

  it('authenticateWithBiometrics returns false when biometrics unavailable', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
    expect(await authenticateWithBiometrics('prompt')).toBe(false);
  });

  it('authenticateWithBiometrics returns success and marks authenticated', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
    expect(await authenticateWithBiometrics('Unlock Amana')).toBe(true);
    expect(await isWithinUnlockGracePeriod()).toBe(true);
  });

  it('authenticateAppUnlock returns true when biometrics disabled', async () => {
    await setBiometricEnabled(false);
    expect(await authenticateAppUnlock()).toBe(true);
  });

  it('authenticateAppUnlock returns true within grace period', async () => {
    await setBiometricEnabled(true);
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
    await authenticateWithBiometrics('Unlock Amana');
    expect(await authenticateAppUnlock()).toBe(true);
  });

  it('authorizeSensitiveAction returns true when biometrics disabled', async () => {
    await setBiometricEnabled(false);
    expect(await authorizeSensitiveAction('action')).toBe(true);
  });

  it('authorizeSensitiveAction calls authenticateWithBiometrics when enabled', async () => {
    await setBiometricEnabled(true);
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
    expect(await authorizeSensitiveAction('action')).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
  });
});
