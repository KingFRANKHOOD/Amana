/**
 * Tests for Vault Dashboard page (#770)
 *
 * Covers: loading state, data state, error state (with retry), empty state.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VaultPage from "@/app/vault/page";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { api } from "@/lib/api";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/link", () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  MockLink.displayName = "MockLink";
  return MockLink;
});

jest.mock("@/hooks/useAuth");
jest.mock("@/hooks/useWalletBalance");
jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getStats: jest.fn(),
      list: jest.fn(),
    },
  },
}));

// Vault sub-components are large; stub them so tests focus on page logic
jest.mock("@/components/vault", () => ({
  VaultHero: ({ status }: { status: string }) => <div data-testid="vault-hero">{status}</div>,
  ReleaseSequenceCard: () => <div data-testid="release-sequence" />,
  VaultValueCard: () => <div data-testid="vault-value" />,
  ContractManifestCard: () => <div data-testid="contract-manifest" />,
  AuditLogCard: () => <div data-testid="audit-log" />,
  NetworkBackboneCard: () => <div data-testid="network-backbone" />,
  VaultFooter: () => <div data-testid="vault-footer" />,
  PaymentOverviewCard: () => <div data-testid="payment-overview" />,
}));

jest.mock("@/components/ui", () => ({
  DriverManifestForm: () => null,
  LoadingState: ({ className }: { className?: string }) => (
    <div data-testid="loading-skeleton" className={className} aria-label="Loading" />
  ),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseWalletBalance = useWalletBalance as jest.MockedFunction<typeof useWalletBalance>;
const mockGetStats = api.trades.getStats as jest.MockedFunction<typeof api.trades.getStats>;
const mockList = api.trades.list as jest.MockedFunction<typeof api.trades.list>;

const AUTH_AUTHENTICATED = {
  address: "GABCDEF1234567890",
  shortAddress: "GABCD...F1234",
  token: "jwt-token",
  isAuthenticated: true,
  isWalletConnected: true,
  isWalletDetected: true,
  isLoading: false,
  error: null,
  connectWallet: jest.fn(),
  authenticate: jest.fn(),
  logout: jest.fn(),
  refreshAuth: jest.fn(),
};

const AUTH_UNAUTHENTICATED = {
  ...AUTH_AUTHENTICATED,
  token: null,
  isAuthenticated: false,
  isWalletConnected: false,
};

const MOCK_STATS = { totalTrades: 5, totalVolume: 50000, openTrades: 2 };
const MOCK_TRADES = {
  items: [
    {
      tradeId: "trade-001",
      buyerAddress: "GBUYER0000000000000000000000000000000000000000000000000",
      sellerAddress: "GSELLER000000000000000000000000000000000000000000000000",
      amountCngn: "10000",
      buyerLossBps: 100,
      sellerLossBps: 200,
      status: "FUNDED",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    },
  ],
  pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
};

function mockWalletDefault() {
  mockUseWalletBalance.mockReturnValue({
    balance: "1000",
    asset: "cNGN",
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWalletDefault();
});

// ── Loading state ──────────────────────────────────────────────────────────────

describe("Vault Dashboard — loading state", () => {
  it("shows skeleton cards while vault data is loading", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    // Make getStats hang so the page stays in loading state
    mockGetStats.mockReturnValue(new Promise(() => undefined));
    mockList.mockReturnValue(new Promise(() => undefined));

    render(<VaultPage />);

    expect(screen.getAllByTestId("loading-skeleton").length).toBeGreaterThan(0);
  });

  it("does not show vault cards while loading", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockReturnValue(new Promise(() => undefined));
    mockList.mockReturnValue(new Promise(() => undefined));

    render(<VaultPage />);

    expect(screen.queryByTestId("vault-hero")).not.toBeInTheDocument();
  });
});

// ── Data state ─────────────────────────────────────────────────────────────────

describe("Vault Dashboard — data state", () => {
  it("shows vault cards after data loads", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockResolvedValue(MOCK_STATS);
    mockList.mockResolvedValue(MOCK_TRADES);

    render(<VaultPage />);

    await waitFor(() => expect(screen.getByTestId("vault-hero")).toBeInTheDocument());
    expect(screen.getByTestId("release-sequence")).toBeInTheDocument();
    expect(screen.getByTestId("vault-value")).toBeInTheDocument();
  });

  it("displays wallet balance when authenticated", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockResolvedValue(MOCK_STATS);
    mockList.mockResolvedValue(MOCK_TRADES);

    render(<VaultPage />);

    await waitFor(() => expect(screen.getByText(/1000/)).toBeInTheDocument());
    expect(screen.getByText(/cNGN/)).toBeInTheDocument();
  });

  it("shows the partner network section", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockResolvedValue(MOCK_STATS);
    mockList.mockResolvedValue(MOCK_TRADES);

    render(<VaultPage />);

    await waitFor(() => expect(screen.getByText("Stellar")).toBeInTheDocument());
  });

  it("hides skeleton after data loads", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockResolvedValue(MOCK_STATS);
    mockList.mockResolvedValue(MOCK_TRADES);

    render(<VaultPage />);

    await waitFor(() => screen.getByTestId("vault-hero"));
    expect(screen.queryByTestId("loading-skeleton")).not.toBeInTheDocument();
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe("Vault Dashboard — error state", () => {
  it("shows error message when fetch fails", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockRejectedValue(new Error("Server unavailable"));
    mockList.mockRejectedValue(new Error("Server unavailable"));

    render(<VaultPage />);

    await waitFor(() =>
      expect(screen.getByText(/server unavailable/i)).toBeInTheDocument()
    );
  });

  it("shows a Retry button on error", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockRejectedValue(new Error("timeout"));
    mockList.mockRejectedValue(new Error("timeout"));

    render(<VaultPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
  });

  it("retries fetching data when Retry is clicked", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(MOCK_STATS);
    mockList.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(MOCK_TRADES);

    render(<VaultPage />);

    await waitFor(() => screen.getByRole("button", { name: /retry/i }));
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByTestId("vault-hero")).toBeInTheDocument());
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe("Vault Dashboard — empty state", () => {
  it("shows empty state when there are no trades", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockResolvedValue({ totalTrades: 0, totalVolume: 0, openTrades: 0 });
    mockList.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
    });

    render(<VaultPage />);

    await waitFor(() =>
      expect(screen.getByText(/no trades yet/i)).toBeInTheDocument()
    );
  });

  it("shows a Create Trade link in the empty state", async () => {
    mockUseAuth.mockReturnValue(AUTH_AUTHENTICATED);
    mockGetStats.mockResolvedValue({ totalTrades: 0, totalVolume: 0, openTrades: 0 });
    mockList.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
    });

    render(<VaultPage />);

    await waitFor(() => expect(screen.getByText(/create trade/i)).toBeInTheDocument());
  });

  it("does not show empty state when not authenticated", async () => {
    mockUseAuth.mockReturnValue(AUTH_UNAUTHENTICATED);

    render(<VaultPage />);

    expect(screen.queryByText(/no trades yet/i)).not.toBeInTheDocument();
  });
});
