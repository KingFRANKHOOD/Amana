import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  authenticateWithBiometrics,
  getBiometricCapability,
  isBiometricEnabled,
  setBiometricEnabled,
} from '../services/biometric.service';

export default function SecuritySettingsScreen() {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [capability, preference] = await Promise.all([
        getBiometricCapability(),
        isBiometricEnabled(),
      ]);
      setAvailable(capability.available && capability.enrolled);
      setEnabled(preference);
    }

    void load();
  }, []);

  async function toggle(next: boolean) {
    if (saving) return;

    if (next && !available) {
      Alert.alert('Biometrics unavailable', 'Set up biometrics or a device passcode before enabling app lock.');
      return;
    }

    setSaving(true);
    try {
      // Always require biometric authentication for any state change (enable or disable)
      const passed = await authenticateWithBiometrics(
        next ? 'Enable Amana app lock' : 'Disable Amana app lock'
      );
      if (!passed) return;

      // Additional confirmation when disabling
      if (!next) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Disable App Lock?',
            'Your app will no longer be protected by biometrics. Anyone with access to your device will be able to open Amana.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Disable', style: 'destructive', onPress: () => resolve(true) },
            ]
          );
        });
        if (!confirmed) return;
      }

      await setBiometricEnabled(next);
      setEnabled(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Security</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.label}>Biometric app lock</Text>
          <Text style={styles.description}>
            Require Face ID, fingerprint, or device passcode for app unlock and sensitive trade actions.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          disabled={saving}
          trackColor={{ false: '#d1d5db', true: '#9bd39b' }}
          thumbColor={enabled ? '#2d6a2d' : '#f9fafb'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f0' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e8e0',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1a3a1a' },
  row: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  copy: { flex: 1 },
  label: { fontSize: 16, fontWeight: '700', color: '#1a3a1a', marginBottom: 4 },
  description: { fontSize: 13, color: '#4b5563', lineHeight: 19 },
});
