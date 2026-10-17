"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";

interface FreighterIdentityState {
  address: string | null;
  shortAddress: string | null;
  isAuthorized: boolean;
  isWalletDetected: boolean;
  isLoading: boolean;
  connectWallet: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

type FreighterIdentitySnapshot = Omit<
  FreighterIdentityState,
  "shortAddress" | "connectWallet" | "refreshIdentity"
>;

const initialState: FreighterIdentitySnapshot = {
  address: null,
  isAuthorized: false,
  isWalletDetected: false,
  isLoading: true,
};

let storeState = initialState;
let hasInitialized = false;
let initializationPromise: Promise<void> | null = null;
let activeOperationId = 0;

const listeners = new Set<() => void>();

function emitStoreChange(nextState: FreighterIdentitySnapshot): void {
  storeState = nextState;
  listeners.forEach((listener) => listener());
}

function updateStore(
  updater: (state: FreighterIdentitySnapshot) => FreighterIdentitySnapshot,
): void {
  emitStoreChange(updater(storeState));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FreighterIdentitySnapshot {
  return storeState;
}

function beginOperation(): number {
  activeOperationId += 1;
  return activeOperationId;
}

function isLatestOperation(operationId: number): boolean {
  return operationId === activeOperationId;
}

async function runRefreshIdentity(): Promise<void> {
  const operationId = beginOperation();
  updateStore((state) => ({ ...state, isLoading: true }));

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

    if (!isLatestOperation(operationId)) {
      return;
    }

    updateStore((state) => ({
      ...state,
      address,
      isAuthorized: hasWallet && hasPermission,
      isWalletDetected: hasWallet,
      isLoading: false,
    }));
  } catch {
    if (!isLatestOperation(operationId)) {
      return;
    }

    updateStore((state) => ({
      ...state,
      address: null,
      isAuthorized: false,
      isWalletDetected: false,
      isLoading: false,
    }));
  }
}

async function ensureInitialized(): Promise<void> {
  if (hasInitialized) {
    return;
  }

  hasInitialized = true;

  if (!initializationPromise) {
    initializationPromise = runRefreshIdentity().finally(() => {
      initializationPromise = null;
    });
  }

  await initializationPromise;
}

async function refreshIdentityStore(): Promise<void> {
  hasInitialized = true;
  await runRefreshIdentity();
}

async function connectWalletStore(): Promise<void> {
  const operationId = beginOperation();
  updateStore((state) => ({ ...state, isLoading: true }));

  try {
    const requestResult = await requestAccess();
    if (requestResult.error === undefined) {
      if (!isLatestOperation(operationId)) {
        return;
      }

      updateStore((state) => ({
        ...state,
        address: requestResult.address,
        isAuthorized: true,
        isWalletDetected: true,
        isLoading: false,
      }));
      return;
    }
  } catch {
    // Fall through to a full refresh so the store reflects the latest wallet state.
  }

  await refreshIdentityStore();
}

export function __resetFreighterIdentityStoreForTests(): void {
  storeState = initialState;
  hasInitialized = false;
  initializationPromise = null;
  activeOperationId = 0;
  listeners.clear();
}

export { refreshIdentityStore };

export function useFreighterIdentity(): FreighterIdentityState {
  const { address, isAuthorized, isWalletDetected, isLoading } =
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensureInitialized();
  }, []);

  const shortAddress = useMemo(
    () => (address ? shortenAddress(address) : null),
    [address],
  );

  return {
    address,
    shortAddress,
    isAuthorized,
    isWalletDetected,
    isLoading,
    connectWallet: connectWalletStore,
    refreshIdentity: refreshIdentityStore,
  };
}
