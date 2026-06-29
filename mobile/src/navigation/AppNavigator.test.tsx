import React from 'react';
import { render } from '@testing-library/react-native';
import { AppNavigator } from './AppNavigator';
import * as useDeepLinkHook from '../hooks/useDeepLink';

// Mock React Navigation
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: any) => children,
  useFocusEffect: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({
    Navigator: ({ children, initialRouteName, screenOptions }: any) => children,
    Screen: ({ name, component: Component }: any) => <Component name={name} />,
  }),
}));

// Mock screens
jest.mock('../screens/WalletConnectScreen', () => 'WalletConnectScreen');
jest.mock('../screens/TradeListScreen', () => 'TradeListScreen');
jest.mock('../screens/TradeDetailScreen', () => 'TradeDetailScreen');
jest.mock('../screens/DisputeDetailScreen', () => 'DisputeDetailScreen');
jest.mock('../screens/CreateTradeScreen', () => 'CreateTradeScreen');
jest.mock('../screens/EvidenceCaptureScreen', () => 'EvidenceCaptureScreen');

// Mock useDeepLink
jest.mock('../hooks/useDeepLink', () => ({
  useDeepLink: jest.fn(),
}));

describe('AppNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render with authenticated user', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { toJSON } = render(<AppNavigator isAuthenticated={true} />);

    expect(toJSON()).toBeTruthy();
  });

  it('should render with unauthenticated user', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { toJSON } = render(<AppNavigator isAuthenticated={false} />);

    expect(toJSON()).toBeTruthy();
  });

  it('should handle trade deep link', () => {
    const handleDeepLinkMock = jest.fn();
    const pendingDeepLink = {
      screen: 'TradeDetail',
      params: { id: 'trade-123' },
    };

    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink,
      handleDeepLink: handleDeepLinkMock,
      navigateToDeepLink: jest.fn(),
    });

    render(<AppNavigator isAuthenticated={true} />);

    expect(handleDeepLinkMock).toHaveBeenCalled();
  });

  it('should handle dispute deep link', () => {
    const handleDeepLinkMock = jest.fn();
    const pendingDeepLink = {
      screen: 'DisputeDetail',
      params: { id: 'dispute-456' },
    };

    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink,
      handleDeepLink: handleDeepLinkMock,
      navigateToDeepLink: jest.fn(),
    });

    render(<AppNavigator isAuthenticated={true} />);

    expect(handleDeepLinkMock).toHaveBeenCalled();
  });

  it('should render all screens in stack', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { getByText } = render(<AppNavigator isAuthenticated={true} />);

    // All screens should be rendered
    expect(getByText('TradeListScreen')).toBeTruthy();
    expect(getByText('TradeDetailScreen')).toBeTruthy();
    expect(getByText('DisputeDetailScreen')).toBeTruthy();
  });
});
