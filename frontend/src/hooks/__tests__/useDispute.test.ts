import { act, renderHook, waitFor } from "@testing-library/react";
import { useDispute } from "../useDispute";
import { useAuth } from "../useAuth";
import { api, ApiError } from "@/lib/api";

jest.mock("../useAuth");

jest.mock("@/lib/api", () => ({
  api: {
    disputes: {
      get: jest.fn(),
      resolve: jest.fn(),
    },
    trades: {
      getEvidence: jest.fn(),
      uploadEvidence: jest.fn(),
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
const mockGetDispute = api.disputes.get as jest.MockedFunction<typeof api.disputes.get>;
const mockResolveDispute = api.disputes.resolve as jest.MockedFunction<typeof api.disputes.resolve>;
const mockGetEvidence = api.trades.getEvidence as jest.MockedFunction<typeof api.trades.getEvidence>;
const mockUploadEvidence = api.trades.uploadEvidence as jest.MockedFunction<typeof api.trades.uploadEvidence>;

const TRADE_ID = "trade-123";

const MOCK_DISPUTE = {
  id: 1,
  tradeId: TRADE_ID,
  initiator: "GBUYER123456789012345678901234567890123456789012345678",
  reason: "Item not delivered",
  status: "OPEN",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  resolvedAt: null,
  trade: {
    buyerAddress: "GBUYER123456789012345678901234567890123456789012345678",
    sellerAddress: "GSELLER12345678901234567890123456789012345678901234567",
    amountUsdc: "5000",
  },
};

const MOCK_EVIDENCE_RECORD = {
  id: "ev-001",
  cid: "QmTestHash123",
  mimeType: "video/mp4",
  uploadedBy: "seller-address",
  createdAt: "2026-05-01T10:00:00.000Z",
};

function authed() {
  mockUseAuth.mockReturnValue({
    token: "token-123",
    isAuthenticated: true,
  } as unknown as ReturnType<typeof useAuth>);
}

describe("useDispute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts in a loading state before the fetch resolves", () => {
    authed();
    mockGetDispute.mockImplementation(() => new Promise(() => {}));
    mockGetEvidence.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useDispute(TRADE_ID));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.dispute).toBeNull();
    expect(result.current.evidence).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads dispute and evidence data on success", async () => {
    authed();
    mockGetDispute.mockResolvedValue(MOCK_DISPUTE);
    mockGetEvidence.mockResolvedValue({ evidence: [MOCK_EVIDENCE_RECORD] });

    const { result } = renderHook(() => useDispute(TRADE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dispute).toEqual(MOCK_DISPUTE);
    expect(result.current.evidence).toEqual([MOCK_EVIDENCE_RECORD]);
    expect(result.current.error).toBeNull();
    expect(mockGetDispute).toHaveBeenCalledWith("token-123", TRADE_ID);
    expect(mockGetEvidence).toHaveBeenCalledWith("token-123", TRADE_ID);
  });

  it("skips fetching and clears loading when not authenticated", async () => {
    mockUseAuth.mockReturnValue({
      token: null,
      isAuthenticated: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useDispute(TRADE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dispute).toBeNull();
    expect(mockGetDispute).not.toHaveBeenCalled();
    expect(mockGetEvidence).not.toHaveBeenCalled();
  });

  it("sets an error message when loading the dispute fails", async () => {
    authed();
    mockGetDispute.mockRejectedValue(new ApiError(404, "Dispute not found"));
    mockGetEvidence.mockResolvedValue({ evidence: [] });

    const { result } = renderHook(() => useDispute(TRADE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dispute).toBeNull();
    expect(result.current.error).toBe("Dispute not found");
  });

  it("uploads evidence and refreshes the evidence list", async () => {
    authed();
    mockGetDispute.mockResolvedValue(MOCK_DISPUTE);
    mockGetEvidence.mockResolvedValue({ evidence: [] });
    mockUploadEvidence.mockResolvedValue({
      evidenceId: "ev-002",
      cid: "QmNewHash",
      ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmNewHash",
    });

    const { result } = renderHook(() => useDispute(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockGetEvidence.mockResolvedValue({ evidence: [MOCK_EVIDENCE_RECORD] });

    const file = new File(["video content"], "evidence.mp4", { type: "video/mp4" });

    await act(async () => {
      await result.current.submitEvidence(file);
    });

    expect(mockUploadEvidence).toHaveBeenCalledWith("token-123", TRADE_ID, file);
    expect(result.current.evidence).toEqual([MOCK_EVIDENCE_RECORD]);
    expect(result.current.error).toBeNull();
  });

  it("sets an error and rethrows when evidence upload fails", async () => {
    authed();
    mockGetDispute.mockResolvedValue(MOCK_DISPUTE);
    mockGetEvidence.mockResolvedValue({ evidence: [] });
    mockUploadEvidence.mockRejectedValue(new ApiError(415, "Unsupported media type"));

    const { result } = renderHook(() => useDispute(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const file = new File(["not a video"], "evidence.txt", { type: "text/plain" });

    await act(async () => {
      await expect(result.current.submitEvidence(file)).rejects.toThrow(
        "Unsupported media type",
      );
    });

    expect(result.current.error).toBe("Unsupported media type");
  });

  it("resolves the dispute and returns the unsigned XDR", async () => {
    authed();
    mockGetDispute.mockResolvedValue(MOCK_DISPUTE);
    mockGetEvidence.mockResolvedValue({ evidence: [] });
    mockResolveDispute.mockResolvedValue({ unsignedXdr: "AAAA-resolve-xdr" });

    const { result } = renderHook(() => useDispute(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let xdr: string | undefined;
    await act(async () => {
      xdr = await result.current.resolveDispute(7000);
    });

    expect(xdr).toBe("AAAA-resolve-xdr");
    expect(mockResolveDispute).toHaveBeenCalledWith("token-123", TRADE_ID, {
      sellerGetsBps: 7000,
    });
    expect(result.current.error).toBeNull();
  });

  it("sets an error and rethrows when dispute resolution fails", async () => {
    authed();
    mockGetDispute.mockResolvedValue(MOCK_DISPUTE);
    mockGetEvidence.mockResolvedValue({ evidence: [] });
    mockResolveDispute.mockRejectedValue(new ApiError(403, "Not authorized to resolve"));

    const { result } = renderHook(() => useDispute(TRADE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.resolveDispute(7000)).rejects.toThrow(
        "Not authorized to resolve",
      );
    });

    expect(result.current.error).toBe("Not authorized to resolve");
  });

  it("re-fetches when the trade id changes", async () => {
    authed();
    mockGetDispute.mockResolvedValue(MOCK_DISPUTE);
    mockGetEvidence.mockResolvedValue({ evidence: [] });

    const { result, rerender } = renderHook(
      ({ tradeId }: { tradeId: string }) => useDispute(tradeId),
      { initialProps: { tradeId: TRADE_ID } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetDispute).toHaveBeenCalledWith("token-123", TRADE_ID);

    const otherTradeId = "trade-456";
    const otherDispute = { ...MOCK_DISPUTE, tradeId: otherTradeId };
    mockGetDispute.mockResolvedValue(otherDispute);

    rerender({ tradeId: otherTradeId });

    await waitFor(() => {
      expect(result.current.dispute?.tradeId).toBe(otherTradeId);
    });
    expect(mockGetDispute).toHaveBeenCalledWith("token-123", otherTradeId);
  });
});
