/**
 * Tests for Trade Detail page (#771)
 *
 * Covers: each trade status, role-based button visibility,
 *         loading state, error state, signing flow.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TradeDetailPage from "@/app/trades/[id]/page";
import { useTradeDetail } from "@/hooks/useTradeDetail";
import { useWallet } from "@/hooks/useWallet";
import { useAuth } from "@/hooks/useAuth";
import { signTransaction } from "@stellar/freighter-api";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "trade-123" }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useTradeDetail");
jest.mock("@/hooks/useWallet");
jest.mock("@/hooks/useAuth");
jest.mock("@/lib/api", () => ({
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
  apiConfig: {
    getStellarNetworkPassphrase: () => "Test SDF Network ; September 2015",
  },
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

const mockUseTradeDetail = useTradeDetail as jest.MockedFunction<typeof useTradeDetail>;
const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockSignTransaction = signTransaction as jest.MockedFunction<typeof signTransaction>;

const BUYER_ADDRESS = "GBUYER123456789012345678901234567890123456789012345678";
const SELLER_ADDRESS = "GSELLER12345678901234567890123456789012345678901234567";

function makeTrade(status: string, overrides = {}) {
  return {
    tradeId: "trade-123",
    buyerAddress: BUYER_ADDRESS,
    sellerAddress: SELLER_ADDRESS,
    amountCngn: "5000",
    buyerLossBps: 100,
    sellerLossBps: 200,
    status,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

function mockAuth(address: string) {
  mockUseAuth.mockReturnValue({
    address,
    token: "jwt-token",
    shortAddress: `${address.slice(0, 6)}...${address.slice(-6)}`,
    isAuthenticated: true,
    isWalletConnected: true,
    isWalletDetected: true,
    isLoading: false,
    error: null,
    connectWallet: jest.fn(),
    authenticate: jest.fn(),
    logout: jest.fn(),
    refreshAuth: jest.fn(),
  });
}

function mockWallet() {
  mockUseWallet.mockReturnValue({
    balance: "1000",
    asset: "cNGN",
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
}

function mockTradeDetail(
  overrides: Partial<ReturnType<typeof useTradeDetail>> = {},
) {
  mockUseTradeDetail.mockReturnValue({
    trade: null,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    deposit: jest.fn(),
    confirmDelivery: jest.fn(),
    releaseFunds: jest.fn(),
    raiseDispute: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWallet();
  mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr", signerAddress: "GABC" } as unknown as Awaited<ReturnType<typeof signTransaction>>);
});

// ── Loading state ──────────────────────────────────────────────────────────────

describe("Trade Detail — loading state", () => {
  it("shows a spinner while loading", () => {
    mockAuth(BUYER_ADDRESS);
    mockTradeDetail({ trade: null, isLoading: true });
    render(<TradeDetailPage />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe("Trade Detail — error state", () => {
  it("shows the error message and a retry button", () => {
    mockAuth(BUYER_ADDRESS);
    mockTradeDetail({ trade: null, error: "Trade not found" });
    render(<TradeDetailPage />);
    expect(screen.getByText("Trade not found")).toBeInTheDocument();
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
  });

  it("calls refetch when retry is clicked", async () => {
    mockAuth(BUYER_ADDRESS);
    const refetch = jest.fn();
    mockTradeDetail({ trade: null, error: "Fetch failed", refetch });
    render(<TradeDetailPage />);
    await userEvent.click(screen.getByText(/retry/i));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Status display ─────────────────────────────────────────────────────────────

describe("Trade Detail — trade status display", () => {
  it.each(["PENDING", "FUNDED", "SETTLED", "DISPUTED", "CANCELLED"])(
    "shows %s status badge",
    (status) => {
      mockAuth(BUYER_ADDRESS);
      mockTradeDetail({ trade: makeTrade(status) });
      render(<TradeDetailPage />);
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  );
});

// ── Role-based button visibility ───────────────────────────────────────────────

describe("Trade Detail — role-based action buttons", () => {
  it("shows Deposit button for buyer in PENDING status", () => {
    mockAuth(BUYER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("PENDING") });
    render(<TradeDetailPage />);
    expect(screen.getByTestId("action-deposit")).toBeInTheDocument();
  });

  it("does NOT show Deposit button for seller in PENDING status", () => {
    mockAuth(SELLER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("PENDING") });
    render(<TradeDetailPage />);
    expect(screen.queryByTestId("action-deposit")).not.toBeInTheDocument();
  });

  it("shows Confirm Delivery for buyer in FUNDED status", () => {
    mockAuth(BUYER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("FUNDED") });
    render(<TradeDetailPage />);
    expect(screen.getByTestId("action-confirm-delivery")).toBeInTheDocument();
  });

  it("shows Release Funds for seller in FUNDED status", () => {
    mockAuth(SELLER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("FUNDED") });
    render(<TradeDetailPage />);
    expect(screen.getByTestId("action-release-funds")).toBeInTheDocument();
  });

  it("shows Initiate Dispute for buyer in FUNDED status", () => {
    mockAuth(BUYER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("FUNDED") });
    render(<TradeDetailPage />);
    expect(screen.getByTestId("action-dispute")).toBeInTheDocument();
  });

  it("shows Initiate Dispute for seller in FUNDED status", () => {
    mockAuth(SELLER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("FUNDED") });
    render(<TradeDetailPage />);
    expect(screen.getByTestId("action-dispute")).toBeInTheDocument();
  });

  it("shows no actions for observer", () => {
    mockAuth("GOBSERVER000000000000000000000000000000000000000000000000");
    mockTradeDetail({ trade: makeTrade("FUNDED") });
    render(<TradeDetailPage />);
    expect(screen.queryByTestId("action-deposit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-confirm-delivery")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-release-funds")).not.toBeInTheDocument();
    expect(screen.getByText(/not a party to this trade/i)).toBeInTheDocument();
  });

  it("shows settled message for SETTLED status", () => {
    mockAuth(BUYER_ADDRESS);
    mockTradeDetail({ trade: makeTrade("SETTLED") });
    render(<TradeDetailPage />);
    expect(screen.getByText(/no further actions are available/i)).toBeInTheDocument();
  });
});

// ── Signing flow ───────────────────────────────────────────────────────────────

describe("Trade Detail — Freighter signing flow", () => {
  it("calls the hook's deposit mutation and signTransaction when Deposit is clicked", async () => {
    mockAuth(BUYER_ADDRESS);
    const deposit = jest.fn().mockResolvedValue({ unsignedXdr: "unsigned-xdr-payload" });
    mockTradeDetail({ trade: makeTrade("PENDING"), deposit });

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-deposit"));

    await waitFor(() => expect(deposit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSignTransaction).toHaveBeenCalledWith(
      "unsigned-xdr-payload",
      expect.objectContaining({ networkPassphrase: "Test SDF Network ; September 2015" })
    ));
  });

  it("shows success message after successful signing", async () => {
    mockAuth(BUYER_ADDRESS);
    const deposit = jest.fn().mockResolvedValue({ unsignedXdr: "xdr-payload" });
    mockTradeDetail({ trade: makeTrade("PENDING"), deposit });

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-deposit"));

    await waitFor(() =>
      expect(screen.getByText(/signed successfully/i)).toBeInTheDocument()
    );
  });

  it("shows error message when signTransaction fails", async () => {
    mockAuth(BUYER_ADDRESS);
    const deposit = jest.fn().mockResolvedValue({ unsignedXdr: "xdr-payload" });
    mockTradeDetail({ trade: makeTrade("PENDING"), deposit });
    mockSignTransaction.mockResolvedValue({
      error: { message: "User cancelled signing" },
    } as unknown as Awaited<ReturnType<typeof signTransaction>>);

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-deposit"));

    await waitFor(() =>
      expect(screen.getByText(/user cancelled signing/i)).toBeInTheDocument()
    );
  });

  it("shows error message when the deposit mutation itself fails", async () => {
    mockAuth(BUYER_ADDRESS);
    const deposit = jest.fn().mockRejectedValue(new Error("Trade already funded"));
    mockTradeDetail({ trade: makeTrade("PENDING"), deposit });

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-deposit"));

    await waitFor(() =>
      expect(screen.getByText(/trade already funded/i)).toBeInTheDocument()
    );
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

  it("calls the hook's confirmDelivery mutation when Confirm Delivery is clicked", async () => {
    mockAuth(BUYER_ADDRESS);
    const confirmDelivery = jest.fn().mockResolvedValue({ unsignedXdr: "confirm-xdr" });
    mockTradeDetail({ trade: makeTrade("FUNDED"), confirmDelivery });

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-confirm-delivery"));

    await waitFor(() => expect(confirmDelivery).toHaveBeenCalledTimes(1));
  });

  it("calls the hook's releaseFunds mutation when Release Funds is clicked", async () => {
    mockAuth(SELLER_ADDRESS);
    const releaseFunds = jest.fn().mockResolvedValue({ unsignedXdr: "release-xdr" });
    mockTradeDetail({ trade: makeTrade("FUNDED"), releaseFunds });

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-release-funds"));

    await waitFor(() => expect(releaseFunds).toHaveBeenCalledTimes(1));
  });

  it("calls the hook's raiseDispute mutation with the entered reason", async () => {
    mockAuth(BUYER_ADDRESS);
    const raiseDispute = jest.fn().mockResolvedValue({ unsignedXdr: "dispute-xdr" });
    mockTradeDetail({ trade: makeTrade("FUNDED"), raiseDispute });
    jest.spyOn(window, "prompt").mockReturnValue("Item never arrived");

    render(<TradeDetailPage />);
    await userEvent.click(screen.getByTestId("action-dispute"));

    await waitFor(() =>
      expect(raiseDispute).toHaveBeenCalledWith("Item never arrived", "other"),
    );
  });
});
