import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import HomeScreen from '../HomeScreen';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

describe('HomeScreen', () => {
  it('renders the app title and subtitle', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Amana Mobile')).toBeTruthy();
    expect(getByText('Trust as a Service for Agricultural Products')).toBeTruthy();
  });

  it('renders getting started content', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Getting Started')).toBeTruthy();
    expect(getByText(/Connect your Stellar wallet/)).toBeTruthy();
  });

  it('does not register its own notification handler or tap listener', () => {
    render(<HomeScreen />);
    expect(Notifications.setNotificationHandler).not.toHaveBeenCalled();
    expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
  });
});
