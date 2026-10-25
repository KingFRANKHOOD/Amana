import { Suspense, lazy, useCallback, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import type { LinkingOptions, NavigationProp } from '@react-navigation/native';

import type { RootStackParamList } from '../types/navigation';
import { useDeepLink } from '../hooks/useDeepLink';

// Lazy-loaded screens — only bundled when navigated to
const WalletConnectScreen = lazy(() => import('../screens/WalletConnectScreen'));
const TradeListScreen = lazy(() => import('../screens/TradeListScreen'));
const TradeDetailScreen = lazy(() => import('../screens/TradeDetailScreen'));
const DisputeDetailScreen = lazy(() => import('../screens/DisputeDetailScreen'));
const CreateTradeScreen = lazy(() => import('../screens/CreateTradeScreen'));
const SyncQueueScreen = lazy(() => import('../screens/SyncQueueScreen'));
const EvidenceCaptureScreen = lazy(() => import('../screens/EvidenceCaptureScreen'));
const VaultDashboard = lazy(() => import('../screens/VaultDashboard'));
const SecuritySettingsScreen = lazy(() => import('../screens/SecuritySettingsScreen'));

const Stack = createStackNavigator<RootStackParamList>();

function ScreenFallback() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#C8A23D" />
    </View>
  );
}

// Deep linking configuration
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['amanavault://', 'https://amanavault.app'],
  config: {
    screens: {
      TradeDetail: 'trades/:id',
      DisputeDetail: 'disputes/:id',
      TradeList: 'trades',
      CreateTrade: 'create-trade',
      EvidenceCapture: 'evidence/:tradeId',
      VaultDashboard: 'vault',
      SecuritySettings: 'security',
      WalletConnect: 'connect',
    },
  },
};

interface AppNavigatorProps {
  isAuthenticated: boolean;
}

export function AppNavigator({ isAuthenticated }: AppNavigatorProps) {
  const { pendingDeepLink, navigateToDeepLink } = useDeepLink();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  // Consume the pending deep link once the container can navigate. Re-runs
  // when the target or auth state changes (navigateToDeepLink depends on both).
  const flushDeepLink = useCallback(() => {
    if (pendingDeepLink && navigationRef.isReady()) {
      navigateToDeepLink(navigationRef as unknown as NavigationProp<RootStackParamList>);
    }
  }, [pendingDeepLink, navigateToDeepLink, navigationRef]);

  useEffect(flushDeepLink, [flushDeepLink]);

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      fallback={null}
      onReady={flushDeepLink}
    >
      <Suspense fallback={<ScreenFallback />}>
        <Stack.Navigator
          initialRouteName={isAuthenticated ? 'TradeList' : 'WalletConnect'}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="WalletConnect" component={WalletConnectScreen} />
          <Stack.Screen name="TradeList" component={TradeListScreen} />
          <Stack.Screen name="TradeDetail" component={TradeDetailScreen} />
          <Stack.Screen name="DisputeDetail" component={DisputeDetailScreen} />
          <Stack.Screen name="CreateTrade" component={CreateTradeScreen} />
          <Stack.Screen name="SyncQueue" component={SyncQueueScreen} />
          <Stack.Screen name="EvidenceCapture" component={EvidenceCaptureScreen} />
          <Stack.Screen name="VaultDashboard" component={VaultDashboard} />
          <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
        </Stack.Navigator>
      </Suspense>
    </NavigationContainer>
  );
}
