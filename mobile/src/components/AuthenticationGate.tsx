import { PropsWithChildren, useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { authenticateAppUnlock, isBiometricEnabled } from '../services/biometric.service';

interface AuthenticationGateProps extends PropsWithChildren {
  authenticated: boolean;
}

export function AuthenticationGate({ authenticated, children }: AuthenticationGateProps) {
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(true);

  const unlock = useCallback(async () => {
    if (!authenticated || !(await isBiometricEnabled())) {
      setLocked(false);
      setChecking(false);
      return;
    }

    setChecking(true);
    const passed = await authenticateAppUnlock();
    setLocked(!passed);
    setChecking(false);
  }, [authenticated]);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        void unlock();
      } else {
        // Immediately lock when backgrounded if biometric lock is enabled
        // This prevents sensitive data from being visible in the task switcher
        const biometricEnabled = await isBiometricEnabled();
        if (biometricEnabled && authenticated) {
          setLocked(true);
        }
      }
    });

    return () => subscription.remove();
  }, [unlock, authenticated]);

  if (!authenticated || (!locked && !checking)) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Amana Locked</Text>
      <Text style={styles.body}>Use biometrics or your device passcode to continue.</Text>
      <TouchableOpacity style={styles.button} onPress={unlock} disabled={checking}>
        <Text style={styles.buttonText}>{checking ? 'Checking...' : 'Unlock'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f4f0',
    padding: 24,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#1a3a1a', marginBottom: 8 },
  body: { fontSize: 14, color: '#4b5563', textAlign: 'center', marginBottom: 24 },
  button: {
    backgroundColor: '#2d6a2d',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
