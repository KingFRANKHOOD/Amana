import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useTradeStore } from '../stores/tradeStore';

type Props = StackScreenProps<RootStackParamList, 'CreateTrade'>;

const COMMODITIES = ['Maize', 'Rice', 'Sorghum', 'Millet', 'Cassava', 'Yam', 'Groundnut', 'Soybean'];
const UNITS = ['kg', 'tonnes', 'bags (50kg)', 'bags (100kg)'];

interface FormData {
  commodity: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  sellerAddress: string;
  buyerRatio: number;
  sellerRatio: number;
  deliveryDays: string;
}

const defaults: FormData = {
  commodity: '',
  quantity: '',
  unit: 'kg',
  pricePerUnit: '',
  sellerAddress: '',
  buyerRatio: 50,
  sellerRatio: 50,
  deliveryDays: '7',
};

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={siStyles.container}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={siStyles.row}>
          <View style={[siStyles.dot, i < current && siStyles.dotDone, i === current && siStyles.dotActive]}>
            {i < current ? (
              <Text style={siStyles.dotText}>✓</Text>
            ) : (
              <Text style={[siStyles.dotText, i === current && siStyles.dotTextActive]}>{i + 1}</Text>
            )}
          </View>
          {i < total - 1 && <View style={[siStyles.line, i < current && siStyles.lineDone]} />}
        </View>
      ))}
    </View>
  );
}

const siStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#e0e8e0',
    justifyContent: 'center', alignItems: 'center',
  },
  dotDone: { backgroundColor: '#2d6a2d' },
  dotActive: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#2d6a2d' },
  dotText: { fontSize: 12, fontWeight: '700', color: '#888' },
  dotTextActive: { color: '#2d6a2d' },
  line: { width: 40, height: 2, backgroundColor: '#e0e8e0', marginHorizontal: 4 },
  lineDone: { backgroundColor: '#2d6a2d' },
});

function Step1Details({
  data,
  update,
  onNext,
}: {
  data: FormData;
  update: (p: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const qty = parseFloat(data.quantity);
  const price = parseFloat(data.pricePerUnit);
  const totalValue = !isNaN(qty) && !isNaN(price) ? `NGN ${(qty * price).toLocaleString()}` : '—';
  const isAddressValid = data.sellerAddress.startsWith('G') && data.sellerAddress.length >= 56;
  const valid = data.commodity !== '' && qty > 0 && price > 0 && isAddressValid;

  return (
    <View style={stepStyles.container}>
      <Text style={styles.sectionTitle}>Step 1: Details</Text>

      <View style={stepStyles.field}>
        <Text style={stepStyles.label}>Commodity</Text>
        <View style={stepStyles.optionsRow}>
          {COMMODITIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[stepStyles.chip, data.commodity === c && stepStyles.chipActive]}
              onPress={() => update({ commodity: c })}
            >
              <Text style={[stepStyles.chipText, data.commodity === c && stepStyles.chipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={stepStyles.row}>
        <View style={[stepStyles.field, { flex: 2 }]}>
          <Text style={stepStyles.label}>Quantity</Text>
          <TextInput
            style={stepStyles.input}
            keyboardType="numeric"
            placeholder="e.g. 500"
            value={data.quantity}
            onChangeText={(v) => update({ quantity: v })}
          />
        </View>
        <View style={[stepStyles.field, { flex: 1 }]}>
          <Text style={stepStyles.label}>Unit</Text>
          <View style={stepStyles.picker}>
            {UNITS.map((u) => (
              <TouchableOpacity
                key={u}
                style={[stepStyles.chipSmall, data.unit === u && stepStyles.chipActive]}
                onPress={() => update({ unit: u })}
              >
                <Text style={[stepStyles.chipTextSmall, data.unit === u && stepStyles.chipTextActive]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={stepStyles.field}>
        <Text style={stepStyles.label}>Price per unit (NGN)</Text>
        <TextInput
          style={stepStyles.input}
          keyboardType="numeric"
          placeholder="e.g. 450"
          value={data.pricePerUnit}
          onChangeText={(v) => update({ pricePerUnit: v })}
        />
      </View>

      <View style={stepStyles.totalRow}>
        <Text style={stepStyles.totalLabel}>Estimated Total</Text>
        <Text style={stepStyles.totalValue}>{totalValue}</Text>
      </View>

      <View style={stepStyles.field}>
        <Text style={stepStyles.label}>Seller Stellar Address</Text>
        <TextInput
          style={stepStyles.input}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="G..."
          value={data.sellerAddress}
          onChangeText={(v) => update({ sellerAddress: v })}
        />
      </View>

      <TouchableOpacity
        style={[stepStyles.btn, !valid && stepStyles.btnDisabled]}
        onPress={onNext}
        disabled={!valid}
      >
        <Text style={stepStyles.btnText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

function Step2Negotiation({
  data,
  update,
  onBack,
  onNext,
}: {
  data: FormData;
  update: (p: Partial<FormData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <View style={stepStyles.container}>
      <Text style={styles.sectionTitle}>Step 2: Negotiation</Text>

      <View style={stepStyles.field}>
        <Text style={stepStyles.label}>Loss Ratio: Buyer {data.buyerRatio}% / Seller {data.sellerRatio}%</Text>
        <View style={stepStyles.ratioRow}>
          <TouchableOpacity
            style={stepStyles.ratioBtn}
            onPress={() => {
              if (data.buyerRatio > 0) {
                const newBuyer = Math.max(0, data.buyerRatio - 10);
                update({ buyerRatio: newBuyer, sellerRatio: 100 - newBuyer });
              }
            }}
          >
            <Text style={stepStyles.ratioBtnText}>−10%</Text>
          </TouchableOpacity>
          <Text style={stepStyles.ratioValue}>{data.buyerRatio} / {data.sellerRatio}</Text>
          <TouchableOpacity
            style={stepStyles.ratioBtn}
            onPress={() => {
              if (data.buyerRatio < 100) {
                const newBuyer = Math.min(100, data.buyerRatio + 10);
                update({ buyerRatio: newBuyer, sellerRatio: 100 - newBuyer });
              }
            }}
          >
            <Text style={stepStyles.ratioBtnText}>+10%</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={stepStyles.field}>
        <Text style={stepStyles.label}>Delivery Window (days)</Text>
        <TextInput
          style={stepStyles.input}
          keyboardType="numeric"
          placeholder="7"
          value={data.deliveryDays}
          onChangeText={(v) => update({ deliveryDays: v })}
        />
      </View>

      <View style={stepStyles.noteCard}>
        <Text style={stepStyles.noteText}>
          Funds will be locked as cNGN. The 1% platform fee is deducted on settlement.
        </Text>
      </View>

      <View style={stepStyles.btnRow}>
        <TouchableOpacity style={stepStyles.btnSecondary} onPress={onBack}>
          <Text style={stepStyles.btnSecondaryText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={stepStyles.btn} onPress={onNext}>
          <Text style={stepStyles.btnText}>Review</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Step3Review({
  data,
  onBack,
  onSubmit,
  submitting,
}: {
  data: FormData;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const qty = parseFloat(data.quantity);
  const price = parseFloat(data.pricePerUnit);
  const total = !isNaN(qty) && !isNaN(price) ? (qty * price).toLocaleString() : '—';

  return (
    <View style={stepStyles.container}>
      <Text style={styles.sectionTitle}>Step 3: Review & Submit</Text>

      <View style={stepStyles.reviewCard}>
        <ReviewRow label="Commodity" value={data.commodity} />
        <ReviewRow label="Quantity" value={`${data.quantity} ${data.unit}`} />
        <ReviewRow label="Total Value" value={`NGN ${total}`} />
        <ReviewRow label="Seller" value={data.sellerAddress} mono />
        <ReviewRow label="Loss Ratio" value={`Buyer ${data.buyerRatio}% / Seller ${data.sellerRatio}%`} />
        <ReviewRow label="Delivery" value={`${data.deliveryDays} days`} />
      </View>

      <View style={stepStyles.noteCard}>
        <Text style={stepStyles.noteText}>
          By submitting, you authorize a Stellar transaction to create an escrow trade.
        </Text>
      </View>

      <View style={stepStyles.btnRow}>
        <TouchableOpacity style={stepStyles.btnSecondary} onPress={onBack} disabled={submitting}>
          <Text style={stepStyles.btnSecondaryText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[stepStyles.btn, stepStyles.btnSubmit, submitting && stepStyles.btnDisabled]}
          onPress={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={stepStyles.btnText}>Create Trade</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ReviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={stepStyles.reviewRow}>
      <Text style={stepStyles.reviewLabel}>{label}</Text>
      <Text style={[stepStyles.reviewValue, mono && stepStyles.mono]}>{value}</Text>
    </View>
  );
}

export default function CreateTradeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>(defaults);
  const [submitting, setSubmitting] = useState(false);
  const { createTrade } = useTradeStore();

  const update = useCallback((partial: Partial<FormData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const qty = parseFloat(data.quantity);
      const price = parseFloat(data.pricePerUnit);
      const amountCngn = !isNaN(qty) && !isNaN(price) ? String(qty * price) : '0';

      const result = await createTrade({
        sellerAddress: data.sellerAddress,
        amountUsdc: amountCngn,
        buyerLossBps: data.buyerRatio * 100,
        sellerLossBps: data.sellerRatio * 100,
        commodity: data.commodity,
        quantity: data.quantity,
        unit: data.unit,
      });

      if (result) {
        Alert.alert('Trade Created', `Trade ${result.tradeId} has been created. Sign the transaction with your wallet to deposit funds.`);
        navigation.replace('TradeDetail', { tradeId: result.tradeId });
      } else {
        Alert.alert('Error', 'Failed to create trade. Please try again.');
      }
    } catch (err) {
      Alert.alert('Error', (err as Error)?.message ?? 'Failed to create trade');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (step > 0) setStep(step - 1);
          else navigation.goBack();
        }}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Trade</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <StepIndicator current={step} total={3} />

        {step === 0 && (
          <Step1Details data={data} update={update} onNext={() => setStep(1)} />
        )}
        {step === 1 && (
          <Step2Negotiation data={data} update={update} onBack={() => setStep(0)} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <Step3Review data={data} onBack={() => setStep(1)} onSubmit={handleSubmit} submitting={submitting} />
        )}
      </ScrollView>
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
  backBtnText: { fontSize: 14, color: '#2d6a2d', fontWeight: '500' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a3a1a' },
  content: { padding: 16, gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1a3a1a', marginBottom: 12 },
});

const stepStyles = StyleSheet.create({
  container: { gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  input: {
    borderWidth: 1,
    borderColor: '#d0d8d0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1a3a1a',
    backgroundColor: '#fff',
  },
  row: { flexDirection: 'row', gap: 12 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d0d8d0',
  },
  chipActive: { backgroundColor: '#2d6a2d', borderColor: '#2d6a2d' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d0d8d0',
  },
  chipTextSmall: { fontSize: 11, color: '#555' },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f0f8f0',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0e8d0',
  },
  totalLabel: { fontSize: 14, color: '#555' },
  totalValue: { fontSize: 14, fontWeight: '700', color: '#2d6a2d' },
  ratioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  ratioBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#e0e8e0',
    borderRadius: 8,
  },
  ratioBtnText: { fontSize: 14, fontWeight: '600', color: '#333' },
  ratioValue: { fontSize: 20, fontWeight: '700', color: '#1a3a1a' },
  noteCard: {
    backgroundColor: '#f0f8f0',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0e8d0',
  },
  noteText: { fontSize: 13, color: '#4a6a4a', lineHeight: 20 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btn: {
    flex: 1,
    backgroundColor: '#2d6a2d',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondary: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#e0e8e0',
  },
  btnSecondaryText: { fontSize: 15, fontWeight: '600', color: '#555' },
  btnSubmit: { backgroundColor: '#2d6a2d' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 0,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  reviewLabel: { fontSize: 13, color: '#888', flex: 1 },
  reviewValue: { fontSize: 13, color: '#1a3a1a', flex: 1.5, textAlign: 'right', fontWeight: '500' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
});
