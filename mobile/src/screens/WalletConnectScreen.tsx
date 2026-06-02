import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';

type Props = StackScreenProps<RootStackParamList, 'WalletConnect'>;

export default function WalletConnectScreen({ navigation }: Props) {
  const [connecting, setConnecting] = useState(false);
  const { setWalletAddress, setToken } = useAuthStore();

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // @stellar/freighter-api is browser-only; on mobile we prompt for manual address entry
      // In a production build this would use a deep-link wallet (e.g. LOBSTR, xBull)
      Alert.prompt(
        'Enter Wallet Address',
        'Paste your Stellar wallet public key (G…)',
        async (address) => {
          if (!address?.startsWith('G') || address.length < 56) {
            Alert.alert('Invalid address', 'Please enter a valid Stellar public key.');
            setConnecting(false);
            return;
          }

          try {
            const { challenge } = await authApi.generateChallenge(address);
            // On mobile we cannot sign with Freighter; we use the challenge as a demo token
            const { token } = await authApi.verifyChallenge(address, challenge);
            await setToken(token);
            setWalletAddress(address);
            navigation.replace('TradeList');
          } catch (err: unknown) {
            Alert.alert('Connection failed', (err as Error)?.message ?? 'Unknown error');
          } finally {
            setConnecting(false);
          }
        },
        'plain-text'
      );
    } catch {
      setConnecting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>🌾</Text>
        <Text style={styles.title}>Amana</Text>
        <Text style={styles.subtitle}>Trust as a Service{'\n'}for Agricultural Products</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connect your Stellar Wallet</Text>
        <Text style={styles.cardBody}>
          Link your wallet to start trading securely with escrow-backed protection.
        </Text>

        <TouchableOpacity
          style={[styles.button, connecting && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Wallet</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f0',
    justifyContent: 'center',
    padding: 24,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 64,
    marginBottom: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1a3a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#4a6a4a',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a3a1a',
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#2d6a2d',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
