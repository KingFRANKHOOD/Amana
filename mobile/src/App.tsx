import { useEffect, useState, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';

import type { RootStackParamList } from './types/navigation';
import { useAuthStore } from './stores/authStore';
import {
  registerForPushNotifications,
  storePushTokenOnBackend,
  setupNotificationListeners,
  checkNotificationPermissions,
  type NotificationData,
} from './services/notification.service';
import WalletConnectScreen from './screens/WalletConnectScreen';
import TradeListScreen from './screens/TradeListScreen';
import TradeDetailScreen from './screens/TradeDetailScreen';
import EvidenceCaptureScreen from './screens/EvidenceCaptureScreen';

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  const { getToken, token } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);
  const navigationRef = useRef<any>(null);

  useEffect(() => {
    getToken().finally(() => setBootstrapped(true));
  }, [getToken]);

  useEffect(() => {
    if (!token) return;

    const setupNotifications = async () => {
      const hasPermission = await checkNotificationPermissions();
      if (!hasPermission) return;

      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        await storePushTokenOnBackend(pushToken, token);
      }
    };

    setupNotifications();

    const unsubscribe = setupNotificationListeners((data: NotificationData) => {
      if (data.tradeId && navigationRef.current) {
        navigationRef.current.navigate('TradeDetail', { tradeId: data.tradeId });
      } else if (data.screen && navigationRef.current) {
        navigationRef.current.navigate(data.screen as any);
      }
    });

    return unsubscribe;
  }, [token]);

  if (!bootstrapped) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f0' }}>
        <ActivityIndicator size="large" color="#2d6a2d" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator
            initialRouteName={token ? 'TradeList' : 'WalletConnect'}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="WalletConnect" component={WalletConnectScreen} />
            <Stack.Screen name="TradeList" component={TradeListScreen} />
            <Stack.Screen name="TradeDetail" component={TradeDetailScreen} />
            <Stack.Screen name="EvidenceCapture" component={EvidenceCaptureScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
