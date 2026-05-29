import { act, renderHook, waitFor } from "@testing-library/react";
import { useTradeDetails } from "../useTradeDetails";
import { tradesApi } from "@/lib/api/trades";

jest.mock("@/lib/api/trades", () => ({
  tradesApi: {
    get: jest.fn(),
  },
}));

const mockedGet = tradesApi.get as jest.MockedFunction<typeof tradesApi.get>;

const MOCK_TRADE = {
  tradeId: "T-001",
  buyerAddress: "GBUYER123456789012345678901234567890123456789012345678",
  sellerAddress: "GSELLER123456789012345678901234567890123456789012345",
  amountCngn: "10000",
  buyerLossBps: 5000,
  sellerLossBps: 5000,
  status: "active",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

describe("useTradeDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts in loading state before fetch resolves", () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useTradeDetails("token-123", "T-001"));

    expect(result.current.loading).toBe(true);
    expect(result.current.trade).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves with trade data on successful fetch", async () => {
    mockedGet.mockResolvedValue(MOCK_TRADE);

    const { result } = renderHook(() => useTradeDetails("token-123", "T-001"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.trade).toEqual(MOCK_TRADE);
    expect(result.current.error).toBeNull();
    expect(mockedGet).toHaveBeenCalledWith("token-123", "T-001");
  });

  it("sets error message on API failure and clears trade", async () => {
    mockedGet.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useTradeDetails("token-123", "T-001"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.trade).toBeNull();
    expect(result.current.error).toBe("Network error");
  });

  it("uses fallback error message for non-Error rejections", async () => {
    mockedGet.mockRejectedValue("plain string error");

    const { result } = renderHook(() => useTradeDetails("token-123", "T-001"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load trade");
  });

  it("skips fetch and clears loading when token is null", async () => {
    const { result } = renderHook(() => useTradeDetails(null, "T-001"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.trade).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("re-fetches when token changes", async () => {
    mockedGet.mockResolvedValue(MOCK_TRADE);

    const { result, rerender } = renderHook(
      ({ token, id }: { token: string | null; id: string }) =>
        useTradeDetails(token, id),
      { initialProps: { token: "token-v1", id: "T-001" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedGet).toHaveBeenCalledWith("token-v1", "T-001");

    mockedGet.mockResolvedValue({ ...MOCK_TRADE, status: "completed" });
    rerender({ token: "token-v2", id: "T-001" });

    await waitFor(() => {
      expect(result.current.trade?.status).toBe("completed");
    });
    expect(mockedGet).toHaveBeenCalledWith("token-v2", "T-001");
  });

  it("re-fetches when trade id changes", async () => {
    mockedGet.mockResolvedValue(MOCK_TRADE);

    const { result, rerender } = renderHook(
      ({ token, id }: { token: string | null; id: string }) =>
        useTradeDetails(token, id),
      { initialProps: { token: "token-123", id: "T-001" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const tradeT002 = { ...MOCK_TRADE, tradeId: "T-002", status: "pending" };
    mockedGet.mockResolvedValue(tradeT002);
    rerender({ token: "token-123", id: "T-002" });

    await waitFor(() => {
      expect(result.current.trade?.tradeId).toBe("T-002");
    });
    expect(mockedGet).toHaveBeenCalledWith("token-123", "T-002");
  });

  it("refetch manually triggers a new API call and updates state", async () => {
    mockedGet.mockResolvedValue(MOCK_TRADE);

    const { result } = renderHook(() => useTradeDetails("token-123", "T-001"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedGet).toHaveBeenCalledTimes(1);

    mockedGet.mockResolvedValue({ ...MOCK_TRADE, status: "completed" });

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.trade?.status).toBe("completed");
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
