import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from '../types/navigation';
import { useAuthStore } from '../stores/authStore';
import WalletConnectScreen from '../screens/WalletConnectScreen';
import TradeListScreen from '../screens/TradeListScreen';
import TradeDetailScreen from '../screens/TradeDetailScreen';
import DisputeDetailScreen from '../screens/DisputeDetailScreen';
import CreateTradeScreen from '../screens/CreateTradeScreen';
import EvidenceCaptureScreen from '../screens/EvidenceCaptureScreen';
import { useDeepLink } from '../hooks/useDeepLink';

const Stack = createStackNavigator<RootStackParamList>();

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
      WalletConnect: 'connect',
    },
  },
};

interface AppNavigatorProps {
  isAuthenticated: boolean;
}

export function AppNavigator({ isAuthenticated }: AppNavigatorProps) {
  const { handleDeepLink, pendingDeepLink } = useDeepLink();

  useEffect(() => {
    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink);
    }
  }, [pendingDeepLink, handleDeepLink]);

  return (
    <NavigationContainer
      linking={linking}
      fallback={null}
      onReady={() => {
        // Handle any initial deep link
        if (pendingDeepLink) {
          handleDeepLink(pendingDeepLink);
        }
      }}
    >
      <Stack.Navigator
        initialRouteName={isAuthenticated ? 'TradeList' : 'WalletConnect'}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="WalletConnect" component={WalletConnectScreen} />
        <Stack.Screen name="TradeList" component={TradeListScreen} />
        <Stack.Screen name="TradeDetail" component={TradeDetailScreen} />
        <Stack.Screen name="DisputeDetail" component={DisputeDetailScreen} />
        <Stack.Screen name="CreateTrade" component={CreateTradeScreen} />
        <Stack.Screen name="EvidenceCapture" component={EvidenceCaptureScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
