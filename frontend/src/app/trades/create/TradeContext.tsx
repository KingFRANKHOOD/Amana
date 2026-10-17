"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { useDraftForm } from "@/hooks/useDraftForm";

const STORAGE_NAMESPACE = "trade:create";

export type TradeData = {
  // Step 1
  commodity: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  currency: string;
  sellerAddress: string;
  // Step 2
  buyerRatio: number;
  sellerRatio: number;
  deliveryDays: string;
  notes: string;
};

const defaults: TradeData = {
  commodity: "",
  quantity: "",
  unit: "kg",
  pricePerUnit: "",
  currency: "NGN",
  sellerAddress: "",
  buyerRatio: 50,
  sellerRatio: 50,
  deliveryDays: "7",
  notes: "",
};

const TradeDataSchema = z.object({
  commodity: z.string(),
  quantity: z.string(),
  unit: z.string(),
  pricePerUnit: z.string(),
  currency: z.string(),
  sellerAddress: z.string(),
  buyerRatio: z.number(),
  sellerRatio: z.number(),
  deliveryDays: z.string(),
  notes: z.string(),
});

// --- Step context (only step navigation) ---
type TradeStepContextType = {
  step: number;
  setStep: (s: number) => void;
};

const TradeStepContext = createContext<TradeStepContextType>({
  step: 1,
  setStep: () => {},
});

// --- Data context (only form data) ---
type TradeDataContextType = {
  data: TradeData;
  update: (partial: Partial<TradeData>) => void;
  clearDraft: () => void;
};

const TradeDataContext = createContext<TradeDataContextType>({
  data: defaults,
  update: () => {},
  clearDraft: () => {},
});

export function TradeProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState(1);
  const draft = useDraftForm<TradeData>(STORAGE_NAMESPACE, TradeDataSchema);
  const [data, setData] = useState<TradeData>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const loaded = draft.load();
      return loaded ? { ...defaults, ...loaded } : defaults;
    } catch {
      return defaults;
    }
  });

  // Debounced auto-save (500ms) to reduce localStorage churn
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    saveTimer.current = window.setTimeout(() => {
      try {
        draft.save(data);
      } catch {
        // ignore storage errors
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, draft]);

  const update = useCallback(
    (partial: Partial<TradeData>) =>
      setData((prev) => ({ ...prev, ...partial })),
    [],
  );

  const clearDraft = useCallback(() => {
    setData(defaults);
    try {
      draft.clear();
    } catch {
      // ignore
    }
  }, []);

  const stepValue = useMemo(() => ({ step, setStep }), [step]);
  const dataValue = useMemo(
    () => ({ data, update, clearDraft }),
    [data, update, clearDraft],
  );

  return (
    <TradeStepContext.Provider value={stepValue}>
      <TradeDataContext.Provider value={dataValue}>
        {children}
      </TradeDataContext.Provider>
    </TradeStepContext.Provider>
  );
}

/** Access step navigation — only re-renders when step changes */
export const useTradeStep = () => useContext(TradeStepContext);

/** Access form data + update — only re-renders when data changes */
export const useTradeData = () => useContext(TradeDataContext);

/** Legacy combined hook (backwards-compatible) */
export function useTrade() {
  const { step, setStep } = useTradeStep();
  const { data, update } = useTradeData();
  return { step, setStep, data, update };
}
