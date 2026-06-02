import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import type { Trade, TradeStatus } from '../types/trade';
import { useTradeStore } from '../stores/tradeStore';
import { useAuthStore } from '../stores/authStore';

type Props = StackScreenProps<RootStackParamList, 'TradeList'>;

const STATUS_FILTERS: Array<{ label: string; value: TradeStatus | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Active', value: 'IN_TRANSIT' },
  { label: 'Disputed', value: 'DISPUTED' },
  { label: 'Done', value: 'COMPLETED' },
];

const STATUS_COLORS: Record<TradeStatus, string> = {
  PENDING: '#F59E0B',
  FUNDED: '#3B82F6',
  IN_TRANSIT: '#14B8A6',
  DELIVERED: '#34D399',
  DISPUTED: '#EF4444',
  COMPLETED: '#34D399',
  REFUNDED: '#6B7280',
};

function TradeCard({ trade, onPress }: { trade: Trade; onPress: () => void }) {
  const statusColor = STATUS_COLORS[trade.status] ?? '#6B7280';
  const shortBuyer = `${trade.buyerAddress.slice(0, 6)}…${trade.buyerAddress.slice(-4)}`;
  const shortSeller = `${trade.sellerAddress.slice(0, 6)}…${trade.sellerAddress.slice(-4)}`;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardRow}>
        <Text style={styles.tradeId}>#{trade.tradeId.slice(0, 8)}</Text>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{trade.status}</Text>
        </View>
      </View>
      <Text style={styles.amount}>{trade.amountUsdc} USDC</Text>
      <View style={styles.cardRow}>
        <Text style={styles.addressLabel}>Buyer: <Text style={styles.address}>{shortBuyer}</Text></Text>
        <Text style={styles.addressLabel}>Seller: <Text style={styles.address}>{shortSeller}</Text></Text>
      </View>
    </TouchableOpacity>
  );
}

export default function TradeListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { trades, isLoading, error, fetchTrades, clearError } = useTradeStore();
  const { clearAuth } = useAuthStore();
  const [activeFilter, setActiveFilter] = useState<TradeStatus | 'ALL'>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    (status?: TradeStatus | 'ALL') => {
      const s = status ?? activeFilter;
      fetchTrades(s === 'ALL' ? undefined : { status: s });
    },
    [activeFilter, fetchTrades]
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTrades(activeFilter === 'ALL' ? undefined : { status: activeFilter });
    setRefreshing(false);
  }, [activeFilter, fetchTrades]);

  const handleFilterChange = (value: TradeStatus | 'ALL') => {
    setActiveFilter(value);
    fetchTrades(value === 'ALL' ? undefined : { status: value });
  };

  const handleLogout = async () => {
    await clearAuth();
    navigation.replace('WalletConnect');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🌾 Trades</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterTab, activeFilter === f.value && styles.filterTabActive]}
            onPress={() => handleFilterChange(f.value)}
          >
            <Text style={[styles.filterLabel, activeFilter === f.value && styles.filterLabelActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError}>
          <Text style={styles.errorText}>{error} — tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* List */}
      {isLoading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2d6a2d" />
        </View>
      ) : (
        <FlatList
          data={trades}
          keyExtractor={(item) => item.tradeId}
          contentContainerStyle={trades.length === 0 ? styles.emptyContainer : styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2d6a2d" />}
          renderItem={({ item }) => (
            <TradeCard
              trade={item}
              onPress={() => navigation.navigate('TradeDetail', { tradeId: item.tradeId })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>No trades found</Text>
              <Text style={styles.emptyBody}>
                {activeFilter === 'ALL'
                  ? 'You have no trades yet.'
                  : `No trades with status "${activeFilter}".`}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f0' },
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
  logoutText: { fontSize: 14, color: '#2d6a2d', fontWeight: '500' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e8e0',
    gap: 6,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f0f4f0',
  },
  filterTabActive: { backgroundColor: '#2d6a2d' },
  filterLabel: { fontSize: 13, color: '#4a6a4a', fontWeight: '500' },
  filterLabelActive: { color: '#fff' },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  errorText: { color: '#DC2626', fontSize: 13 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyState: { alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1a3a1a', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    gap: 8,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tradeId: { fontSize: 13, color: '#888', fontFamily: 'monospace' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '600' },
  amount: { fontSize: 20, fontWeight: '700', color: '#1a3a1a' },
  addressLabel: { fontSize: 12, color: '#888' },
  address: { color: '#2d6a2d', fontFamily: 'monospace' },
});
