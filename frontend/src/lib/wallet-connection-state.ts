export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WalletConnectionState {
  status: WalletStatus;
  publicKey: string | null;
  error: string | null;
}

const DEFAULT_STATE: WalletConnectionState = {
  status: 'disconnected',
  publicKey: null,
  error: null,
};

export function walletConnectionState(
  current: Partial<WalletConnectionState> = {}
): WalletConnectionState {
  return { ...DEFAULT_STATE, ...current };
}

export function isConnected(state: WalletConnectionState): boolean {
  return state.status === 'connected' && state.publicKey !== null;
}

export function isConnecting(state: WalletConnectionState): boolean {
  return state.status === 'connecting';
}

export function hasError(state: WalletConnectionState): boolean {
  return state.status === 'error';
}
