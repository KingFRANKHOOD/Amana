import { act } from "@testing-library/react";
import { useTradeStore } from "@/stores/tradeStore";
import { tradesApi } from "@/lib/api/trades";
import type { TradeResponse } from "@/lib/api/types";

jest.mock("@/lib/api/trades", () => ({
  tradesApi: { list: jest.fn() },
}));

const mockList = tradesApi.list as jest.Mock;

const makeTrade = (tradeId: string, status = "active"): TradeResponse => ({
  tradeId,
  buyerAddress: "GBUYER",
  sellerAddress: "GSELLER",
  amountCngn: "100",
  buyerLossBps: 0,
  sellerLossBps: 0,
  status,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const mockPage = (items: TradeResponse[], total = items.length) => ({
  items,
  pagination: { page: 1, limit: 10, total, totalPages: Math.ceil(total / 10) },
});

beforeEach(() => {
  useTradeStore.setState({ trades: [], total: 0, page: 1, filters: {}, isLoading: false, error: null });
  mockList.mockReset();
});

describe("tradeStore", () => {
  it("initialises with empty state", () => {
    const s = useTradeStore.getState();
    expect(s.trades).toEqual([]);
    expect(s.total).toBe(0);
    expect(s.page).toBe(1);
    expect(s.filters).toEqual({});
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("fetchTrades populates trades and total", async () => {
    const items = [makeTrade("t1"), makeTrade("t2")];
    mockList.mockResolvedValueOnce(mockPage(items, 2));

    await act(async () => {
      await useTradeStore.getState().fetchTrades("tok");
    });

    const s = useTradeStore.getState();
    expect(s.trades).toHaveLength(2);
    expect(s.total).toBe(2);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("fetchTrades sets error on failure", async () => {
    mockList.mockRejectedValueOnce(new Error("Network error"));

    await act(async () => {
      await useTradeStore.getState().fetchTrades("tok");
    });

    const s = useTradeStore.getState();
    expect(s.error).toBe("Network error");
    expect(s.isLoading).toBe(false);
  });

  it("setPage updates page then refetches", async () => {
    mockList.mockResolvedValue(mockPage([]));

    await act(async () => {
      await useTradeStore.getState().setPage(3, "tok");
    });

    expect(useTradeStore.getState().page).toBe(3);
    expect(mockList).toHaveBeenCalledWith("tok", expect.objectContaining({ page: 3 }));
  });

  it("setFilter resets page to 1 then refetches", async () => {
    useTradeStore.setState({ page: 5 });
    mockList.mockResolvedValue(mockPage([]));

    await act(async () => {
      await useTradeStore.getState().setFilter({ status: "pending" }, "tok");
    });

    expect(useTradeStore.getState().page).toBe(1);
    expect(useTradeStore.getState().filters).toEqual({ status: "pending" });
  });

  it("addTrade prepends trade and increments total", () => {
    useTradeStore.setState({ trades: [makeTrade("t1")], total: 1 });
    act(() => { useTradeStore.getState().addTrade(makeTrade("t2")); });

    const s = useTradeStore.getState();
    expect(s.trades[0].tradeId).toBe("t2");
    expect(s.total).toBe(2);
  });

  it("updateTrade applies patch optimistically", async () => {
    useTradeStore.setState({ trades: [makeTrade("t1", "pending")], total: 1 });

    await act(async () => {
      await useTradeStore.getState().updateTrade("t1", { status: "active" });
    });

    expect(useTradeStore.getState().trades[0].status).toBe("active");
  });

  it("updateTrade rolls back on server error", async () => {
    useTradeStore.setState({ trades: [makeTrade("t1", "pending")], total: 1 });
    const serverFn = jest.fn().mockRejectedValueOnce(new Error("fail"));

    await act(async () => {
      await useTradeStore.getState().updateTrade("t1", { status: "active" }, serverFn);
    });

    expect(useTradeStore.getState().trades[0].status).toBe("pending");
  });

  it("removeTrade removes trade optimistically", async () => {
    useTradeStore.setState({ trades: [makeTrade("t1"), makeTrade("t2")], total: 2 });

    await act(async () => {
      await useTradeStore.getState().removeTrade("t1");
    });

    const s = useTradeStore.getState();
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].tradeId).toBe("t2");
    expect(s.total).toBe(1);
  });

  it("removeTrade rolls back on server error", async () => {
    useTradeStore.setState({ trades: [makeTrade("t1"), makeTrade("t2")], total: 2 });
    const serverFn = jest.fn().mockRejectedValueOnce(new Error("fail"));

    await act(async () => {
      await useTradeStore.getState().removeTrade("t1", serverFn);
    });

    expect(useTradeStore.getState().trades).toHaveLength(2);
    expect(useTradeStore.getState().total).toBe(2);
  });
});
