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
import { ACTIVE_TRADE_STATUSES, type Trade, type TradeStatus } from '../types/trade';
import { useTradeStore } from '../stores/tradeStore';
import { useAuthStore } from '../stores/authStore';
import { offlineQueue, QueuedAction } from '../services/offline-queue';
import { OfflineBanner } from '../components/OfflineBanner';
import { DEFAULT_STATUS_COLOR, STATUS_COLORS } from '../constants/tradeStatus';

type Props = StackScreenProps<RootStackParamList, 'TradeList'>;

type TradeListFilter = TradeStatus | 'ALL' | 'ACTIVE';

const STATUS_FILTERS: Array<{ label: string; value: TradeListFilter }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING_SIGNATURE' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Disputed', value: 'DISPUTED' },
  { label: 'Done', value: 'COMPLETED' },
];

function TradeCard({ trade, onPress }: { trade: Trade; onPress: () => void }) {
  const statusColor = STATUS_COLORS[trade.status] ?? DEFAULT_STATUS_COLOR;
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
  const [activeFilter, setActiveFilter] = useState<TradeListFilter>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [queued, setQueued] = useState<QueuedAction[]>([]);

  const load = useCallback(
    (status?: TradeListFilter) => {
      const s = status ?? activeFilter;
      fetchTrades(s === 'ALL' || s === 'ACTIVE' ? undefined : { status: s });
    },
    [activeFilter, fetchTrades]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => offlineQueue.subscribe(setQueued), []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTrades(activeFilter === 'ALL' || activeFilter === 'ACTIVE' ? undefined : { status: activeFilter });
    setRefreshing(false);
  }, [activeFilter, fetchTrades]);

  const handleFilterChange = (value: TradeListFilter) => {
    setActiveFilter(value);
    fetchTrades(value === 'ALL' || value === 'ACTIVE' ? undefined : { status: value });
  };

  const visibleTrades = activeFilter === 'ACTIVE'
    ? trades.filter((trade) => ACTIVE_TRADE_STATUSES.has(trade.status))
    : trades;

  const handleLogout = async () => {
    await clearAuth();
    navigation.replace('WalletConnect');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🌾 Trades</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('CreateTrade')}>
            <Text style={styles.createBtnText}>+ New</Text>
          </TouchableOpacity>
          {queued.length > 0 && (
            <TouchableOpacity style={styles.syncBadge} onPress={() => navigation.navigate('SyncQueue')}>
              <Text style={styles.syncBadgeText}>Pending {queued.length}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigation.navigate('SecuritySettings')}>
            <Text style={styles.securityText}>Security</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Offline & Sync Status Banner */}
      <OfflineBanner onPressQueue={() => navigation.navigate('SyncQueue')} />

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
          data={visibleTrades}
          keyExtractor={(item) => item.tradeId}
          contentContainerStyle={visibleTrades.length === 0 ? styles.emptyContainer : styles.listContent}
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
                  : activeFilter === 'ACTIVE'
                    ? 'You have no active trades.'
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
  headerActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  createBtnText: { fontSize: 14, color: '#2d6a2d', fontWeight: '700' },
  syncBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  syncBadgeText: { color: '#92400E', fontSize: 12, fontWeight: '700' },
  securityText: { fontSize: 14, color: '#2d6a2d', fontWeight: '500' },
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
  card: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e8e0',
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tradeId: { fontSize: 14, fontWeight: '700', color: '#1a3a1a' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '700' },
  amount: { marginVertical: 12, fontSize: 20, fontWeight: '700', color: '#1a3a1a' },
  addressLabel: { fontSize: 11, color: '#6b806b' },
  address: { color: '#2d4a2d', fontWeight: '600' },
  errorBanner: { margin: 12, padding: 12, backgroundColor: '#fee2e2', borderRadius: 8 },
  errorText: { color: '#991b1b', fontSize: 13 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flexGrow: 1 },
  listContent: { paddingBottom: 24 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a3a1a' },
  emptyBody: { marginTop: 6, fontSize: 14, color: '#6b806b', textAlign: 'center' },
});

/* … truncated 1296 chars — edit only what you need near the top … */
