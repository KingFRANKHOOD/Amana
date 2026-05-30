import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import type { TradeStatus } from '../types/trade';
import { useTradeStore } from '../stores/tradeStore';

type Props = StackScreenProps<RootStackParamList, 'TradeDetail'>;

const STATUS_COLORS: Record<TradeStatus, string> = {
  PENDING: '#F59E0B',
  FUNDED: '#3B82F6',
  IN_TRANSIT: '#14B8A6',
  DELIVERED: '#34D399',
  DISPUTED: '#EF4444',
  COMPLETED: '#34D399',
  REFUNDED: '#6B7280',
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

export default function TradeDetailScreen({ route, navigation }: Props) {
  const { tradeId } = route.params;
  const insets = useSafeAreaInsets();
  const { currentTrade, isLoading, error, fetchTrade, confirmDelivery, initiateDispute, clearError } =
    useTradeStore();

  const [disputeModalVisible, setDisputeModalVisible] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchTrade(tradeId);
  }, [tradeId, fetchTrade]);

  const handleConfirmDelivery = useCallback(() => {
    Alert.alert(
      'Confirm Delivery',
      'Are you sure you received the goods in good condition?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'default',
          onPress: async () => {
            setActionLoading(true);
            await confirmDelivery(tradeId);
            setActionLoading(false);
          },
        },
      ]
    );
  }, [tradeId, confirmDelivery]);

  const handleDisputeSubmit = useCallback(async () => {
    if (!disputeReason.trim()) {
      Alert.alert('Reason required', 'Please describe the issue before submitting a dispute.');
      return;
    }
    setActionLoading(true);
    await initiateDispute(tradeId, disputeReason.trim());
    setActionLoading(false);
    setDisputeModalVisible(false);
    setDisputeReason('');
  }, [tradeId, disputeReason, initiateDispute]);

  const canConfirm = currentTrade?.status === 'IN_TRANSIT' || currentTrade?.status === 'FUNDED';
  const canDispute =
    currentTrade?.status === 'IN_TRANSIT' ||
    currentTrade?.status === 'FUNDED' ||
    currentTrade?.status === 'DELIVERED';
  const canUploadEvidence = currentTrade?.status === 'DISPUTED';

  if (isLoading && !currentTrade) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#2d6a2d" />
      </View>
    );
  }

  if (!currentTrade) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error ?? 'Trade not found'}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[currentTrade.status] ?? '#6B7280';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trade Detail</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status card */}
        <View style={styles.statusCard}>
          <Text style={styles.tradeIdText}>#{currentTrade.tradeId.slice(0, 12)}…</Text>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{currentTrade.status}</Text>
          </View>
          <Text style={styles.amountText}>{currentTrade.amountUsdc} USDC</Text>
        </View>

        {/* Error banner */}
        {error && (
          <TouchableOpacity style={styles.errorBanner} onPress={clearError}>
            <Text style={styles.errorBannerText}>{error} — tap to dismiss</Text>
          </TouchableOpacity>
        )}

        {/* Trade info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trade Info</Text>
          <InfoRow label="Trade ID" value={currentTrade.tradeId} mono />
          <InfoRow label="Buyer" value={currentTrade.buyerAddress} mono />
          <InfoRow label="Seller" value={currentTrade.sellerAddress} mono />
          {currentTrade.createdAt && (
            <InfoRow label="Created" value={new Date(currentTrade.createdAt).toLocaleDateString()} />
          )}
          {currentTrade.updatedAt && (
            <InfoRow label="Updated" value={new Date(currentTrade.updatedAt).toLocaleDateString()} />
          )}
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>

          {canConfirm && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmBtn, actionLoading && styles.btnDisabled]}
              onPress={handleConfirmDelivery}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.actionBtnText}>✅ Confirm Delivery</Text>
              )}
            </TouchableOpacity>
          )}

          {canDispute && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.disputeBtn, actionLoading && styles.btnDisabled]}
              onPress={() => setDisputeModalVisible(true)}
              disabled={actionLoading}
            >
              <Text style={styles.actionBtnText}>⚠️ Initiate Dispute</Text>
            </TouchableOpacity>
          )}

          {canUploadEvidence && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.evidenceBtn]}
              onPress={() => navigation.navigate('EvidenceCapture', { tradeId: currentTrade.tradeId })}
            >
              <Text style={styles.actionBtnText}>📹 Upload Evidence</Text>
            </TouchableOpacity>
          )}

          {!canConfirm && !canDispute && !canUploadEvidence && (
            <Text style={styles.noActionsText}>No actions available for this trade status.</Text>
          )}
        </View>
      </ScrollView>

      {/* Dispute reason modal */}
      <Modal
        visible={disputeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDisputeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Initiate Dispute</Text>
            <Text style={styles.modalBody}>Describe the issue with this trade:</Text>
            <TextInput
              style={styles.textInput}
              multiline
              numberOfLines={4}
              placeholder="e.g. Goods arrived damaged, quantity mismatch…"
              value={disputeReason}
              onChangeText={setDisputeReason}
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => { setDisputeModalVisible(false); setDisputeReason(''); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.submitBtn, actionLoading && styles.btnDisabled]}
                onPress={handleDisputeSubmit}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f0' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
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
  backText: { fontSize: 14, color: '#2d6a2d', fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a3a1a' },
  content: { padding: 16, gap: 16 },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  tradeIdText: { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 },
  statusText: { fontSize: 13, fontWeight: '700' },
  amountText: { fontSize: 28, fontWeight: '800', color: '#1a3a1a' },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 8,
  },
  errorBannerText: { color: '#DC2626', fontSize: 13 },
  errorText: { fontSize: 16, color: '#DC2626', marginBottom: 16 },
  backBtn: { padding: 12 },
  backBtnText: { color: '#2d6a2d', fontSize: 15 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a3a1a', marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 13, color: '#888', flex: 1 },
  infoValue: { fontSize: 13, color: '#1a3a1a', flex: 2, textAlign: 'right' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
  actionBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtn: { backgroundColor: '#2d6a2d' },
  disputeBtn: { backgroundColor: '#DC2626' },
  evidenceBtn: { backgroundColor: '#2563EB' },
  btnDisabled: { opacity: 0.6 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  noActionsText: { fontSize: 14, color: '#888', textAlign: 'center', paddingVertical: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1a3a1a' },
  modalBody: { fontSize: 14, color: '#555' },
  textInput: {
    borderWidth: 1,
    borderColor: '#d0d8d0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1a3a1a',
    minHeight: 100,
  },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#f0f4f0' },
  cancelBtnText: { color: '#555', fontSize: 15, fontWeight: '600' },
  submitBtn: { backgroundColor: '#DC2626' },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
