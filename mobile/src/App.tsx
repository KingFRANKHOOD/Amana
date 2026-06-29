import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from './stores/authStore';
import { AppNavigator } from './navigation/AppNavigator';

export default function App() {
  const { getToken, token } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    getToken().finally(() => setBootstrapped(true));
  }, [getToken]);

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
        <AppNavigator isAuthenticated={!!token} />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
