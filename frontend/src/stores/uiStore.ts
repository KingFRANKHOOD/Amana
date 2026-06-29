import { create } from "zustand";
import { persist } from "zustand/middleware";

type CurrencyDisplay = "USDC" | "NGN";

interface UIState {
  sidebarCollapsed: boolean;
  currencyDisplay: CurrencyDisplay;
  theme: "dark";
  toggleSidebar: () => void;
  setCurrency: (currency: CurrencyDisplay) => void;
  resetDefaults: () => void;
}

const defaultState = {
  sidebarCollapsed: false,
  currencyDisplay: "USDC" as CurrencyDisplay,
  theme: "dark" as const,
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      ...defaultState,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setCurrency: (currency) => set({ currencyDisplay: currency }),
      resetDefaults: () => set(defaultState),
    }),
    {
      name: "amana-ui-storage",
    },
  ),
);
