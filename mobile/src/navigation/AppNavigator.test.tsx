import React from 'react';
import { render } from '@testing-library/react-native';
import { AppNavigator } from './AppNavigator';
import * as useDeepLinkHook from '../hooks/useDeepLink';

// Mock React Navigation
const mockNavigationRef = { isReady: jest.fn(() => true), navigate: jest.fn() };

jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    NavigationContainer: ({ children, onReady }: any) => {
      useEffect(() => onReady?.(), []);
      return children;
    },
    useNavigationContainerRef: () => mockNavigationRef,
  useFocusEffect: jest.fn(),
  useNavigation: jest.fn(),
  };
});

jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({
    Navigator: ({ children }: any) => children,
    // Don't render the component to avoid triggering lazy import dynamic import errors.
    // Render the screen name as a text node so we can assert screens are registered.
    Screen: ({ name }: any) => name,
  }),
}));

// Mock screens
jest.mock('../screens/WalletConnectScreen', () => 'WalletConnectScreen');
jest.mock('../screens/TradeListScreen', () => 'TradeListScreen');
jest.mock('../screens/TradeDetailScreen', () => 'TradeDetailScreen');
jest.mock('../screens/DisputeDetailScreen', () => 'DisputeDetailScreen');
jest.mock('../screens/CreateTradeScreen', () => 'CreateTradeScreen');
jest.mock('../screens/SyncQueueScreen', () => 'SyncQueueScreen');
jest.mock('../screens/EvidenceCaptureScreen', () => 'EvidenceCaptureScreen');
jest.mock('../screens/VaultDashboard', () => 'VaultDashboard');
jest.mock('../screens/SecuritySettingsScreen', () => 'SecuritySettingsScreen');

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

  it.each([
    ['trade', { screen: 'TradeDetail', params: { id: 'trade-123' } }],
    ['dispute', { screen: 'DisputeDetail', params: { id: 'dispute-456' } }],
  ])('navigates to a pending %s deep link via the container ref (#1637)', (_, pendingDeepLink) => {
    const navigateToDeepLink = jest.fn();
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink,
      handleDeepLink: jest.fn(),
      navigateToDeepLink,
    });

    render(<AppNavigator isAuthenticated={true} />);

    expect(navigateToDeepLink).toHaveBeenCalledWith(mockNavigationRef);
  });

  it('waits for the container to be ready before navigating', () => {
    mockNavigationRef.isReady.mockReturnValueOnce(false);
    const navigateToDeepLink = jest.fn();
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: { screen: 'TradeDetail', params: { id: 't' } },
      handleDeepLink: jest.fn(),
      navigateToDeepLink,
    });

    render(<AppNavigator isAuthenticated={true} />);

    // first readiness check is skipped; the next one flushes exactly once
    expect(navigateToDeepLink).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when there is no pending deep link', () => {
    const navigateToDeepLink = jest.fn();
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      navigateToDeepLink,
    });

    render(<AppNavigator isAuthenticated={true} />);

    expect(navigateToDeepLink).not.toHaveBeenCalled();
  });

  it('should render all screens in stack', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { toJSON } = render(<AppNavigator isAuthenticated={true} />);
    const json = JSON.stringify(toJSON());

    // All screens should be registered in the stack
    expect(json).toContain('TradeList');
    expect(json).toContain('TradeDetail');
    expect(json).toContain('DisputeDetail');
  });
});
