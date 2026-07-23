import { act, renderHook, waitFor } from "@testing-library/react";
import { useTradeDetail } from "../useTradeDetail";
import { useAuth } from "../useAuth";
import { api, ApiError } from "@/lib/api";

jest.mock("../useAuth");

jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      get: jest.fn(),
      deposit: jest.fn(),
      confirmDelivery: jest.fn(),
      releaseFunds: jest.fn(),
      initiateDispute: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  },
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGet = api.trades.get as jest.MockedFunction<typeof api.trades.get>;
const mockDeposit = api.trades.deposit as jest.MockedFunction<typeof api.trades.deposit>;
const mockConfirmDelivery = api.trades.confirmDelivery as jest.MockedFunction<typeof api.trades.confirmDelivery>;
const mockReleaseFunds = api.trades.releaseFunds as jest.MockedFunction<typeof api.trades.releaseFunds>;
const mockInitiateDispute = api.trades.initiateDispute as jest.MockedFunction<typeof api.trades.initiateDispute>;

const TRADE_ID = "trade-123";

function makeTrade(status: string) {
  return {
    tradeId: TRADE_ID,
    buyerAddress: "GBUYER123456789012345678901234567890123456789012345678",
    sellerAddress: "GSELLER12345678901234567890123456789012345678901234567",
    amountCngn: "5000",
    buyerLossBps: 100,
    sellerLossBps: 200,
    status,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function authed() {
  mockUseAuth.mockReturnValue({
    token: "token-123",
    isAuthenticated: true,
  } as unknown as ReturnType<typeof useAuth>);
}

describe("useTradeDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts in a loading state before the fetch resolves", () => {
    authed();
    mockGet.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.trade).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads the trade on success", async () => {
    authed();
    mockGet.mockResolvedValue(makeTrade("PENDING"));

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.trade?.status).toBe("PENDING");
    expect(result.current.error).toBeNull();
    expect(mockGet).toHaveBeenCalledWith("token-123", TRADE_ID);
  });

  it("sets an error message when the fetch fails", async () => {
    authed();
    mockGet.mockRejectedValue(new ApiError(404, "Trade not found"));

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.trade).toBeNull();
    expect(result.current.error).toBe("Trade not found");
  });

  it("skips fetching and clears loading when not authenticated", async () => {
    mockUseAuth.mockReturnValue({
      token: null,
      isAuthenticated: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.trade).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each(["FUNDED", "IN_TRANSIT"])(
    "polls every 10 seconds while the trade is in %s status",
    async (status) => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      authed();
      mockGet.mockResolvedValue(makeTrade(status));

      renderHook(() => useTradeDetail(TRADE_ID));

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(mockGet).toHaveBeenCalledTimes(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(2);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["PENDING", "COMPLETED", "DISPUTED", "CANCELLED"])(
    "does not poll while the trade is in the terminal/non-polling status %s",
    async (status) => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      authed();
      mockGet.mockResolvedValue(makeTrade(status));

      renderHook(() => useTradeDetail(TRADE_ID));

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(mockGet).toHaveBeenCalledTimes(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(1);
    },
  );

  it("stops polling once a poll resolves with a terminal status", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    authed();
    mockGet.mockResolvedValueOnce(makeTrade("FUNDED"));

    renderHook(() => useTradeDetail(TRADE_ID));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);

    mockGet.mockResolvedValue(makeTrade("COMPLETED"));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("refetches manually via refetch()", async () => {
    authed();
    mockGet.mockResolvedValue(makeTrade("PENDING"));

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("deposit() calls the deposit mutation and returns the unsigned XDR", async () => {
    authed();
    mockGet.mockResolvedValue(makeTrade("PENDING"));
    mockDeposit.mockResolvedValue({ unsignedXdr: "deposit-xdr" });

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const response = await result.current.deposit();

    expect(mockDeposit).toHaveBeenCalledWith("token-123", TRADE_ID);
    expect(response).toEqual({ unsignedXdr: "deposit-xdr" });
  });

  it("confirmDelivery() calls the confirmDelivery mutation", async () => {
    authed();
    mockGet.mockResolvedValue(makeTrade("FUNDED"));
    mockConfirmDelivery.mockResolvedValue({ unsignedXdr: "confirm-xdr" });

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const response = await result.current.confirmDelivery();

    expect(mockConfirmDelivery).toHaveBeenCalledWith("token-123", TRADE_ID);
    expect(response).toEqual({ unsignedXdr: "confirm-xdr" });
  });

  it("releaseFunds() calls the releaseFunds mutation", async () => {
    authed();
    mockGet.mockResolvedValue(makeTrade("FUNDED"));
    mockReleaseFunds.mockResolvedValue({ unsignedXdr: "release-xdr" });

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const response = await result.current.releaseFunds();

    expect(mockReleaseFunds).toHaveBeenCalledWith("token-123", TRADE_ID);
    expect(response).toEqual({ unsignedXdr: "release-xdr" });
  });

  it("raiseDispute() calls initiateDispute with the reason and category", async () => {
    authed();
    mockGet.mockResolvedValue(makeTrade("FUNDED"));
    mockInitiateDispute.mockResolvedValue({ unsignedXdr: "dispute-xdr" });

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const response = await result.current.raiseDispute("Item not delivered", "quality");

    expect(mockInitiateDispute).toHaveBeenCalledWith(
      "token-123",
      TRADE_ID,
      "Item not delivered",
      "quality",
    );
    expect(response).toEqual({ unsignedXdr: "dispute-xdr" });
  });

  it("rejects mutations when there is no auth token", async () => {
    mockUseAuth.mockReturnValue({
      token: null,
      isAuthenticated: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useTradeDetail(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.deposit()).rejects.toThrow("Not authenticated");
    expect(mockDeposit).not.toHaveBeenCalled();
  });
});
