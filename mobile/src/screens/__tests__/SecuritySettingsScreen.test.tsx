import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SecuritySettingsScreen from '../SecuritySettingsScreen';
import * as biometric from '../../services/biometric.service';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../services/biometric.service', () => ({
  getBiometricCapability: jest.fn(),
  isBiometricEnabled: jest.fn(),
  setBiometricEnabled: jest.fn(),
  authenticateWithBiometrics: jest.fn(),
}));

describe('SecuritySettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (biometric.getBiometricCapability as jest.Mock).mockResolvedValue({ available: true, enrolled: true });
    (biometric.isBiometricEnabled as jest.Mock).mockResolvedValue(false);
    (biometric.authenticateWithBiometrics as jest.Mock).mockResolvedValue(true);
    (biometric.setBiometricEnabled as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders the security header and settings row', () => {
    const { getByText } = render(<SecuritySettingsScreen />);
    expect(getByText('Security')).toBeTruthy();
    expect(getByText('Biometric app lock')).toBeTruthy();
  });

  it('enables biometric lock after authentication', async () => {
    const { UNSAFE_getByType } = render(<SecuritySettingsScreen />);
    const { Switch } = require('react-native');
    await waitFor(() => {
      expect(biometric.isBiometricEnabled).toHaveBeenCalled();
    });
    const switchEl = UNSAFE_getByType(Switch);
    fireEvent(switchEl, 'valueChange', true);
    await waitFor(() => {
      expect(biometric.authenticateWithBiometrics).toHaveBeenCalled();
      expect(biometric.setBiometricEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('shows alert when biometrics unavailable', async () => {
    (biometric.getBiometricCapability as jest.Mock).mockResolvedValue({ available: false, enrolled: false });
    const Alert = require('react-native').Alert;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { UNSAFE_getByType } = render(<SecuritySettingsScreen />);
    const { Switch } = require('react-native');
    await waitFor(() => {
      expect(biometric.isBiometricEnabled).toHaveBeenCalled();
    });
    const switchEl = UNSAFE_getByType(Switch);
    fireEvent(switchEl, 'valueChange', true);
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Biometrics unavailable', expect.any(String));
    });
    alertSpy.mockRestore();
  });
});
