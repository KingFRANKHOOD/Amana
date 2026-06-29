/**
 * Tests for GlobalSearch component (#773)
 *
 * Covers: keyboard trigger, search input, results display,
 *         empty results, navigation on select, error state.
 */

import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearch } from "@/components/GlobalSearch";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  api: {
    search: {
      query: jest.fn(),
    },
  },
}));

const mockPush = jest.fn();
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockSearch = api.search.query as jest.MockedFunction<typeof api.search.query>;

const MOCK_AUTH = {
  token: "test-token",
  address: null,
  shortAddress: null,
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

const MOCK_RESULTS = {
  trades: [
    { id: "t1", title: "Trade #001", subtitle: "FUNDED" },
    { id: "t2", title: "Trade #002", subtitle: "PENDING" },
  ],
  users: [{ id: "u1", title: "Alice Seller" }],
  contracts: [{ id: "c1", title: "Contract AMN-99" }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRouter.mockReturnValue({ push: mockPush } as unknown as ReturnType<typeof useRouter>);
  mockUseAuth.mockReturnValue(MOCK_AUTH);
  mockSearch.mockResolvedValue(MOCK_RESULTS);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Opens search by firing keydown directly on document (no timer dependency). */
function pressMetaK() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

function pressCtrlK() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
}

function pressEscape() {
  fireEvent.keyDown(document, { key: "Escape" });
}

// ── Keyboard trigger ──────────────────────────────────────────────────────────

describe("GlobalSearch — keyboard trigger", () => {
  it("renders a closed trigger button by default", () => {
    render(<GlobalSearch />);
    expect(screen.getByRole("button", { name: /open global search/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the modal on Cmd+K", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the modal on Ctrl+K", () => {
    render(<GlobalSearch />);
    pressCtrlK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressEscape();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when clicking the Esc button", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await userEvent.click(screen.getByRole("button", { name: /close search/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles closed on second Cmd+K", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressMetaK();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ── Search input ──────────────────────────────────────────────────────────────

describe("GlobalSearch — search input", () => {
  it("shows the search input when open", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("shows idle hint text before typing", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it("debounces and calls the search API after 300ms", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();

    await user.type(screen.getByRole("searchbox"), "maize");
    expect(mockSearch).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(300));
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("test-token", "maize"));

    jest.useRealTimers();
  });

  it("does not call the API for an empty query", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();

    await user.type(screen.getByRole("searchbox"), "m");
    await user.clear(screen.getByRole("searchbox"));
    act(() => jest.advanceTimersByTime(300));
    expect(mockSearch).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});

// ── Results display ───────────────────────────────────────────────────────────

describe("GlobalSearch — results display", () => {
  it("renders grouped results after a successful search", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("searchbox"), "trade");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Contracts")).toBeInTheDocument();
    expect(screen.getByText("Alice Seller")).toBeInTheDocument();
    expect(screen.getByText("Contract AMN-99")).toBeInTheDocument();

    jest.useRealTimers();
  });

  it("shows subtitle text when provided", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("searchbox"), "trade");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(screen.getByText("FUNDED")).toBeInTheDocument());

    jest.useRealTimers();
  });
});

// ── Empty results ─────────────────────────────────────────────────────────────

describe("GlobalSearch — empty results", () => {
  it("shows a no-results message when API returns empty arrays", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockSearch.mockResolvedValue({ trades: [], users: [], contracts: [] });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("searchbox"), "xyznotfound");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(screen.getByText(/no results for/i)).toBeInTheDocument());

    jest.useRealTimers();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("GlobalSearch — error state", () => {
  it("shows an error message when the search API fails", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockSearch.mockRejectedValue(new Error("Network error"));

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("searchbox"), "trade");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(screen.getByText(/search failed/i)).toBeInTheDocument());

    jest.useRealTimers();
  });
});

// ── Navigation on select ──────────────────────────────────────────────────────

describe("GlobalSearch — navigation on select", () => {
  it("navigates to the trade detail page when a trade result is clicked", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("searchbox"), "trade");
    act(() => jest.advanceTimersByTime(300));
    await waitFor(() => screen.getByText("Trade #001"));

    jest.useRealTimers();
    await userEvent.click(screen.getByText("Trade #001"));

    expect(mockPush).toHaveBeenCalledWith("/trades/t1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates via keyboard ArrowDown + Enter", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("searchbox"), "trade");
    act(() => jest.advanceTimersByTime(300));
    await waitFor(() => screen.getByText("Trade #001"));

    // First ArrowDown selects index 0 (Trade #001)
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    jest.useRealTimers();

    expect(mockPush).toHaveBeenCalledWith("/trades/t1");
  });
});
