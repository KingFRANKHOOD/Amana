import { act, renderHook, waitFor } from "@testing-library/react";
import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
import { useWalletConnection } from "../useWalletConnection";

jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  getAddress: jest.fn(),
  requestAccess: jest.fn(),
}));

const mockedIsConnected = isConnected as jest.MockedFunction<typeof isConnected>;
const mockedIsAllowed = isAllowed as jest.MockedFunction<typeof isAllowed>;
const mockedGetAddress = getAddress as jest.MockedFunction<typeof getAddress>;
const mockedRequestAccess = requestAccess as jest.MockedFunction<typeof requestAccess>;

const WALLET_ADDRESS = "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12";

describe("useWalletConnection hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("checks wallet state successfully when connected and allowed", async () => {
    mockedIsConnected.mockResolvedValue({ isConnected: true } as any);
    mockedIsAllowed.mockResolvedValue({ isAllowed: true } as any);
    mockedGetAddress.mockResolvedValue({ address: WALLET_ADDRESS } as any);

    const { result } = renderHook(() => useWalletConnection());

    let walletState;
    await act(async () => {
      walletState = await result.current.checkWalletState();
    });

    expect(walletState).toEqual({
      hasWallet: true,
      hasPermission: true,
      address: WALLET_ADDRESS,
    });
  });

  it("handles connectWallet action and updates address", async () => {
    mockedRequestAccess.mockResolvedValue({ address: WALLET_ADDRESS } as any);

    const { result } = renderHook(() => useWalletConnection());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.address).toBe(WALLET_ADDRESS);
    expect(result.current.isWalletConnected).toBe(true);
    expect(result.current.isWalletDetected).toBe(true);
  });
});
