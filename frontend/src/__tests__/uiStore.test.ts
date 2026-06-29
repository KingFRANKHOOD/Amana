import { describe, it, expect, beforeEach } from "@jest/globals";
import { useUIStore } from "@/stores/uiStore";

describe("UI Store", () => {
  beforeEach(() => {
    useUIStore.getState().resetDefaults();
    localStorage.clear();
  });

  it("should toggle sidebar", () => {
    const initialState = useUIStore.getState().sidebarCollapsed;
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(!initialState);
  });

  it("should switch currency", () => {
    useUIStore.getState().setCurrency("NGN");
    expect(useUIStore.getState().currencyDisplay).toBe("NGN");
  });

  it("should persist state to localStorage", () => {
    useUIStore.getState().toggleSidebar();
    useUIStore.getState().setCurrency("NGN");

    const stored = localStorage.getItem("amana-ui-storage");
    expect(stored).toBeTruthy();
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.state.sidebarCollapsed).toBe(true);
      expect(parsed.state.currencyDisplay).toBe("NGN");
    }
  });

  it("should reset to defaults", () => {
    useUIStore.getState().toggleSidebar();
    useUIStore.getState().setCurrency("NGN");

    useUIStore.getState().resetDefaults();

    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    expect(useUIStore.getState().currencyDisplay).toBe("USDC");
  });
});
