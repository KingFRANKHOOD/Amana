import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from './stores/authStore';
import {
  registerForPushNotifications,
  storePushTokenOnBackend,
  setupNotificationListeners,
  getNotificationOptInPreference,
} from './services/notification.service';
import type { RootStackParamList } from './types/navigation';
import { AppNavigator } from './navigation/AppNavigator';
import type { NotificationData } from './services/notification.service';
import { AuthenticationGate } from './components/AuthenticationGate';
import { offlineQueue } from './services/offline-queue';

/** Valid screen names from RootStackParamList for runtime validation */
const KNOWN_SCREENS: readonly string[] = [
  'WalletConnect',
  'TradeList',
  'TradeDetail',
  'DisputeDetail',
  'CreateTrade',
  'SyncQueue',
  'EvidenceCapture',
  'VaultDashboard',
  'SecuritySettings',
] as const;

/**
 * Type guard to validate a screen name is a known navigation target.
 * Returns true if the screen is a valid key of RootStackParamList.
 */
function isKnownScreen(screen: string): screen is keyof RootStackParamList {
  return KNOWN_SCREENS.includes(screen);
}

export default function App() {
  const { getToken, token } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  useEffect(() => {
    getToken().finally(() => setBootstrapped(true));
  }, [getToken]);

  useEffect(() => {
    if (!token) return;
    let cleanup: (() => void) | undefined;
    offlineQueue.init()
      .then(() => {
        cleanup = offlineQueue.startNetworkListener();
      })
      .catch(() => undefined);
    return () => cleanup?.();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const setupNotifications = async () => {
      // Respect a prior in-app opt-out: don't re-prompt or re-register on
      // every launch once the user has explicitly declined.
      const preference = await getNotificationOptInPreference();
      if (preference === 'denied') return;

      // For a first-time user (preference === 'unset') this triggers the
      // native permission prompt; for a returning user who already granted
      // permission it resolves immediately with the existing token.
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
        // Validate screen name to prevent crashes from malformed push payloads
        const targetScreen = data.screen;
        if (isKnownScreen(targetScreen)) {
          navigationRef.current.navigate(targetScreen);
        } else {
          // Fallback to TradeList for unknown screens
          console.warn(`Unknown screen in push payload: ${targetScreen}, falling back to TradeList`);
          navigationRef.current.navigate('TradeList');
        }
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
        <AuthenticationGate authenticated={!!token}>
          <AppNavigator isAuthenticated={!!token} />
        </AuthenticationGate>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
