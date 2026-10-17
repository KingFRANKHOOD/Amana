import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import * as Network from 'expo-network';
import { offlineQueue, QueuedAction } from '../services/offline-queue';

interface OfflineBannerProps {
  onPressQueue?: () => void;
}

export function OfflineBanner({ onPressQueue }: OfflineBannerProps) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [queuedItems, setQueuedItems] = useState<QueuedAction[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    // Check initial network state
    const checkNetwork = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        if (isMounted) {
          setIsOnline(state.isConnected === true && state.isInternetReachable !== false);
        }
      } catch {
        if (isMounted) setIsOnline(false);
      }
    };

    void checkNetwork();

    // Periodic network check
    const networkInterval = setInterval(checkNetwork, 10000);

    // Subscribe to offline queue changes
    const unsubscribeQueue = offlineQueue.subscribe((items) => {
      if (isMounted) {
        setQueuedItems(items);
        const processingCount = items.filter((i) => i.status === 'processing').length;
        setIsSyncing(processingCount > 0);
      }
    });

    return () => {
      isMounted = false;
      clearInterval(networkInterval);
      unsubscribeQueue();
    };
  }, []);

  const pendingCount = queuedItems.filter((i) => i.status === 'pending').length;
  const failedCount = queuedItems.filter((i) => i.status === 'failed').length;
  const totalQueued = queuedItems.length;

  if (isOnline && totalQueued === 0) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        !isOnline ? styles.offlineBg : isSyncing ? styles.syncingBg : failedCount > 0 ? styles.failedBg : styles.pendingBg,
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.icon}>
          {!isOnline ? '📡' : isSyncing ? '🔄' : failedCount > 0 ? '⚠️' : '📦'}
        </Text>
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {!isOnline
              ? 'Offline Mode Active'
              : isSyncing
              ? 'Syncing offline drafts...'
              : failedCount > 0
              ? `${failedCount} draft${failedCount === 1 ? '' : 's'} failed to sync`
              : `${pendingCount} draft${pendingCount === 1 ? '' : 's'} pending sync`}
          </Text>
          <Text style={styles.subtitle}>
            {!isOnline
              ? 'Actions are securely queued and will sync once connected.'
              : failedCount > 0
              ? 'Tap to review and retry failed actions.'
              : 'Drafts will upload automatically.'}
          </Text>
        </View>
      </View>

      {totalQueued > 0 && onPressQueue && (
        <TouchableOpacity style={styles.button} onPress={onPressQueue} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Queue ({totalQueued})</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  offlineBg: {
    backgroundColor: '#FEF3C7', // Amber / Warning
  },
  syncingBg: {
    backgroundColor: '#DBEAFE', // Blue / Info
  },
  failedBg: {
    backgroundColor: '#FEE2E2', // Red / Error
  },
  pendingBg: {
    backgroundColor: '#ECFDF5', // Mint / Light green
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  icon: {
    fontSize: 18,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 11,
    color: '#4B5563',
    marginTop: 1,
  },
  button: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
