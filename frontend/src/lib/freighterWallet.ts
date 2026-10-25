import { getAddress, isAllowed, isConnected } from "@stellar/freighter-api";

export interface FreighterWalletState {
  hasWallet: boolean;
  hasPermission: boolean;
  address: string | null;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export async function readFreighterWalletState(): Promise<FreighterWalletState> {
  try {
    const [connectedResult, allowedResult] = await Promise.all([
      isConnected(),
      isAllowed(),
    ]);

    const hasWallet =
      connectedResult.error === undefined && connectedResult.isConnected;
    const hasPermission =
      allowedResult.error === undefined && allowedResult.isAllowed;

    let address: string | null = null;
    if (hasWallet && hasPermission) {
      const addressResult = await getAddress();
      if (addressResult.error === undefined) {
        address = addressResult.address;
      }
    }

    return { hasWallet, hasPermission, address };
  } catch (error) {
    console.error("Failed to read wallet state:", error);
    return { hasWallet: false, hasPermission: false, address: null };
  }
}
