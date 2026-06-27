import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTradeStore } from '../stores/tradeStore';
import { useAuthStore } from '../stores/authStore';
import type { Trade } from '../types/trade';

const ACTIVE_STATUSES = new Set(['FUNDED', 'IN_TRANSIT'] as const);

function SkeletonBox({ width, height }: { width: number | string; height: number }) {
  return <View style={[styles.skeleton, { width: width as number, height }]} />;
}

function LoadingSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <SkeletonBox width="60%" height={20} />
      <View style={styles.statsRow}>
        <SkeletonBox width="45%" height={80} />
        <SkeletonBox width="45%" height={80} />
      </View>
      {[0, 1, 2].map((i) => (
        <SkeletonBox key={i} width="100%" height={60} />
      ))}
    </View>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const shortId = trade.tradeId.slice(0, 8);
  const isActive = ACTIVE_STATUSES.has(trade.status as 'FUNDED' | 'IN_TRANSIT');
  return (
    <View style={styles.tradeRow}>
      <Text style={styles.tradeId}>#{shortId}</Text>
      <Text style={styles.tradeAmount}>{trade.amountUsdc} USDC</Text>
      <View style={[styles.statusDot, isActive ? styles.statusActive : styles.statusInactive]} />
    </View>
  );
}

export default function VaultDashboard() {
  const insets = useSafeAreaInsets();
  const { trades, isLoading, error, fetchTrades } = useTradeStore();
  const { walletAddress } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades, retryKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTrades();
    setRefreshing(false);
  }, [fetchTrades]);

  const activeTrades = useMemo(
    () => trades.filter((t) => ACTIVE_STATUSES.has(t.status as 'FUNDED' | 'IN_TRANSIT')),
    [trades]
  );

  const totalLocked = useMemo(
    () => activeTrades.reduce((sum, t) => sum + parseFloat(t.amountUsdc || '0'), 0),
    [activeTrades]
  );

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : null;

  const recentTrades = trades.slice(0, 10);

  if (isLoading && !refreshing) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Vault Dashboard</Text>
        </View>
        <LoadingSkeleton />
      </View>
    );
  }

  if (error && trades.length === 0) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => setRetryKey((k) => k + 1)}>
          <Text style={styles.retryLabel}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vault Dashboard</Text>
        <View style={[styles.connectionBadge, walletAddress ? styles.connected : styles.disconnected]}>
          <Text style={styles.connectionText}>
            {walletAddress ? shortAddress : 'Not connected'}
          </Text>
        </View>
      </View>

      <FlatList
        data={recentTrades}
        keyExtractor={(item) => item.tradeId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2d6a2d" />}
        ListHeaderComponent={
          <>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Total Locked</Text>
                <Text style={styles.statValue}>${totalLocked.toFixed(2)}</Text>
                <Text style={styles.statUnit}>USDC</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Active Trades</Text>
                <Text style={styles.statValue}>{activeTrades.length}</Text>
                <Text style={styles.statUnit}>in progress</Text>
              </View>
            </View>
            <Text style={styles.sectionLabel}>Recent Trades</Text>
          </>
        }
        renderItem={({ item }) => <TradeRow trade={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No trades yet</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f0' },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e8e0',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1a3a1a' },
  connectionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  connected: { backgroundColor: '#d1fae5' },
  disconnected: { backgroundColor: '#fee2e2' },
  connectionText: { fontSize: 11, fontWeight: '600', color: '#065f46', fontFamily: 'monospace' },
  listContent: { padding: 16, gap: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statLabel: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  statValue: { fontSize: 26, fontWeight: '800', color: '#1a3a1a' },
  statUnit: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  tradeId: { flex: 1, fontSize: 13, color: '#374151', fontFamily: 'monospace' },
  tradeAmount: { fontSize: 14, fontWeight: '600', color: '#1a3a1a' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusActive: { backgroundColor: '#10b981' },
  statusInactive: { backgroundColor: '#d1d5db' },
  separator: { height: 8 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { color: '#6b7280', fontSize: 14 },
  errorText: { color: '#dc2626', fontSize: 15, textAlign: 'center', marginBottom: 16 },
  retryButton: { backgroundColor: '#2d6a2d', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryLabel: { color: '#fff', fontWeight: '600' },
  skeletonContainer: { padding: 16, gap: 12 },
  skeleton: { backgroundColor: '#e5e7eb', borderRadius: 8 },
});
