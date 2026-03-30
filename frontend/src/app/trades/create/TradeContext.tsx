"use client";
import { createContext, useContext, useState } from "react";

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

type TradeContextType = {
  step: number;
  setStep: (s: number) => void;
  data: TradeData;
  update: (partial: Partial<TradeData>) => void;
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

const TradeContext = createContext<TradeContextType>({} as TradeContextType);

export function TradeProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<TradeData>(defaults);

  const update = (partial: Partial<TradeData>) =>
    setData((prev) => ({ ...prev, ...partial }));

  return (
    <TradeContext.Provider value={{ step, setStep, data, update }}>
      {children}
    </TradeContext.Provider>
  );
}

export const useTrade = () => useContext(TradeContext);
