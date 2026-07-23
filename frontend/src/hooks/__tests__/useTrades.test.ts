import { act, renderHook, waitFor } from "@testing-library/react";
import { useTrades } from "../useTrades";
import { useAuth } from "../useAuth";
import { api, ApiError } from "@/lib/api";

jest.mock("../useAuth");

jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      list: jest.fn(),
      create: jest.fn(),
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
const mockList = api.trades.list as jest.MockedFunction<typeof api.trades.list>;
const mockCreate = api.trades.create as jest.MockedFunction<typeof api.trades.create>;

const MOCK_TRADE = {
  tradeId: "trade-001",
  buyerAddress: "GBUYER123456789012345678901234567890123456789012345678",
  sellerAddress: "GSELLER12345678901234567890123456789012345678901234567",
  amountCngn: "10000",
  buyerLossBps: 5000,
  sellerLossBps: 5000,
  status: "PENDING",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

function authed() {
  mockUseAuth.mockReturnValue({
    token: "token-123",
    isAuthenticated: true,
  } as unknown as ReturnType<typeof useAuth>);
}

describe("useTrades", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts in a loading state", () => {
    authed();
    mockList.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useTrades());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.trades).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("fetches trades after the debounce window elapses", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    authed();
    mockList.mockResolvedValue({
      items: [MOCK_TRADE],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const { result } = renderHook(() => useTrades({ status: "FUNDED", page: 2, limit: 10 }));

    expect(mockList).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith("token-123", {
      status: "FUNDED",
      page: 2,
      limit: 10,
      sort: undefined,
    });
    expect(result.current.trades).toEqual([MOCK_TRADE]);
    expect(result.current.total).toBe(1);
    expect(result.current.page).toBe(2);
    expect(result.current.limit).toBe(10);
    expect(result.current.error).toBeNull();
  });

  it("defaults page and limit when not provided", async () => {
    authed();
    mockList.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const { result } = renderHook(() => useTrades());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.page).toBe(1);
    expect(result.current.limit).toBe(20);
  });

  it("debounces rapid param changes into a single fetch with the latest params", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    authed();
    mockList.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const { rerender } = renderHook(({ page }: { page: number }) => useTrades({ page }), {
      initialProps: { page: 1 },
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    rerender({ page: 2 });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    rerender({ page: 3 });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(
      "token-123",
      expect.objectContaining({ page: 3 }),
    );
  });

  it("sets an error message when the fetch fails", async () => {
    authed();
    mockList.mockRejectedValue(new ApiError(500, "Server unavailable"));

    const { result } = renderHook(() => useTrades());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Server unavailable");
    expect(result.current.trades).toEqual([]);
  });

  it("skips fetching and clears loading when not authenticated", async () => {
    mockUseAuth.mockReturnValue({
      token: null,
      isAuthenticated: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useTrades());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.trades).toEqual([]);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("refetch() fetches immediately, bypassing the debounce", async () => {
    authed();
    mockList.mockResolvedValue({
      items: [MOCK_TRADE],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const { result } = renderHook(() => useTrades());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockList).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("createTrade() calls the create API and returns the created trade", async () => {
    authed();
    mockList.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    mockCreate.mockResolvedValue({ tradeId: "trade-999", unsignedXdr: "created-xdr" });

    const { result } = renderHook(() => useTrades());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const createRequest = {
      sellerAddress: "GSELLER12345678901234567890123456789012345678901234567",
      amountCngn: "5000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    };
    const response = await result.current.createTrade(createRequest);

    expect(mockCreate).toHaveBeenCalledWith("token-123", createRequest);
    expect(response).toEqual({ tradeId: "trade-999", unsignedXdr: "created-xdr" });
  });

  it("createTrade() rejects when there is no auth token", async () => {
    mockUseAuth.mockReturnValue({
      token: null,
      isAuthenticated: false,
    } as unknown as ReturnType<typeof useAuth>);
    mockList.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const { result } = renderHook(() => useTrades());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.createTrade({
      sellerAddress: "GSELLER12345678901234567890123456789012345678901234567",
      amountCngn: "5000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    })).rejects.toThrow("Not authenticated");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
