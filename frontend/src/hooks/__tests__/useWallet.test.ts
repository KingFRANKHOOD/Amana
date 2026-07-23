import { act, renderHook, waitFor } from "@testing-library/react";
import { useWallet } from "../useWallet";
import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
} from "@stellar/freighter-api";
import { Horizon } from "@stellar/stellar-sdk";

jest.mock("@stellar/freighter-api", () => ({
  getAddress: jest.fn(),
  getNetwork: jest.fn(),
  isAllowed: jest.fn(),
  isConnected: jest.fn(),
}));

const mockLoadAccount = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: mockLoadAccount,
    })),
  },
}));

const mockGetAddress = getAddress as jest.MockedFunction<typeof getAddress>;
const mockGetNetwork = getNetwork as jest.MockedFunction<typeof getNetwork>;
const mockIsAllowed = isAllowed as jest.MockedFunction<typeof isAllowed>;
const mockIsConnected = isConnected as jest.MockedFunction<typeof isConnected>;
const MockServer = Horizon.Server as unknown as jest.Mock;

const PUBLIC_KEY = "GBUYER123456789012345678901234567890123456789012345678";

function connectedWallet() {
  mockIsConnected.mockResolvedValue({ isConnected: true });
  mockIsAllowed.mockResolvedValue({ isAllowed: true });
  mockGetAddress.mockResolvedValue({ address: PUBLIC_KEY });
  mockGetNetwork.mockResolvedValue({
    network: "TESTNET",
    networkPassphrase: "Test SDF Network ; September 2015",
  });
}

function testnetAccount() {
  mockLoadAccount.mockResolvedValue({
    balances: [
      { asset_type: "native", balance: "100.5000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GISSUER123",
        balance: "250.0000000",
      },
    ],
  });
}

describe("useWallet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts in a connecting state", () => {
    mockIsConnected.mockImplementation(() => new Promise(() => {}));
    mockIsAllowed.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useWallet());

    expect(result.current.isConnecting).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
  });

  it("resolves as disconnected when Freighter is not connected", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });
    mockIsAllowed.mockResolvedValue({ isAllowed: false });

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.isConnecting).toBe(false));

    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.network).toBeNull();
    expect(result.current.balances).toEqual({});
    expect(mockGetAddress).not.toHaveBeenCalled();
  });

  it("connects and loads public key, network, and balances", async () => {
    connectedWallet();
    testnetAccount();

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.isConnecting).toBe(false));

    expect(result.current.isConnected).toBe(true);
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
    expect(result.current.network).toBe("TESTNET");
    expect(result.current.balances).toEqual({
      XLM: "100.5000000",
      USDC: "250.0000000",
    });
    expect(result.current.error).toBeNull();
    expect(MockServer).toHaveBeenCalledWith("https://horizon-testnet.stellar.org");
  });

  it("sets an error message when balance fetching fails", async () => {
    connectedWallet();
    mockLoadAccount.mockRejectedValue(new Error("Horizon request failed"));

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.isConnecting).toBe(false));

    expect(result.current.error).toBe("Horizon request failed");
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
  });

  it("detects a network switch and refetches balances for the new network", async () => {
    connectedWallet();
    testnetAccount();

    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
    expect(result.current.network).toBe("TESTNET");

    mockGetNetwork.mockResolvedValue({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "42.0000000" }],
    });

    await act(async () => {
      await result.current.refreshBalances();
    });

    await waitFor(() => expect(result.current.network).toBe("PUBLIC"));
    expect(result.current.balances).toEqual({ XLM: "42.0000000" });
    expect(MockServer).toHaveBeenLastCalledWith("https://horizon.stellar.org");
  });

  it("detects a disconnect on the next refresh cycle", async () => {
    connectedWallet();
    testnetAccount();

    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
    expect(result.current.isConnected).toBe(true);

    mockIsAllowed.mockResolvedValue({ isAllowed: false });

    await act(async () => {
      await result.current.refreshBalances();
    });

    await waitFor(() => expect(result.current.isConnected).toBe(false));
    expect(result.current.publicKey).toBeNull();
    expect(result.current.balances).toEqual({});
  });

  it("refreshes balances automatically every 30 seconds", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    connectedWallet();
    testnetAccount();

    renderHook(() => useWallet());

    await waitFor(() => expect(mockLoadAccount).toHaveBeenCalledTimes(1));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(mockLoadAccount).toHaveBeenCalledTimes(2);
  });
});
