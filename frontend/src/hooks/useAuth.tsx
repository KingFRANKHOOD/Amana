"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
  signMessage,
} from "@stellar/freighter-api";
import { api, ApiError } from "@/lib/api";
import { trackAuthEvent } from "@/lib/analytics";
import { refreshIdentityStore } from "./useFreighterIdentity";

// Compatibility marker for consumers that still gate requests on `token`.
// This is not a credential and is never sent to the API.
const AUTHENTICATED_SESSION = "http-only-cookie";

interface AuthState {
  address: string | null;
  shortAddress: string | null;
  token: string | null;
  isAuthenticated: boolean;
  isWalletConnected: boolean;
  isWalletDetected: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  connectWallet: () => Promise<void>;
  authenticate: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    address: null,
    shortAddress: null,
    token: null,
    isAuthenticated: false,
    isWalletConnected: false,
    isWalletDetected: false,
    isLoading: true,
    error: null,
  });

  const checkWalletState = useCallback(async () => {
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
      console.error('Failed to read wallet state:', error);
      return { hasWallet: false, hasPermission: false, address: null };
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { hasWallet, hasPermission, address } = await checkWalletState();
      // Remove credentials written by older releases. The active session can
      // only be discovered through the server's HttpOnly cookie.
      sessionStorage.removeItem("amana_jwt");
      let isAuthenticated = false;
      try {
        await api.auth.validate();
        isAuthenticated = true;
      } catch {
        isAuthenticated = false;
      }

      setState({
        address,
        shortAddress: address ? shortenAddress(address) : null,
        token: isAuthenticated ? AUTHENTICATED_SESSION : null,
        isAuthenticated,
        isWalletConnected: hasWallet && hasPermission,
        isWalletDetected: hasWallet,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to refresh auth",
      }));
    }
  }, [checkWalletState]);

  const connectWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      trackAuthEvent("connect_wallet", "started");
      const requestResult = await requestAccess();
      if (requestResult.error !== undefined) {
        throw new Error(requestResult.error.message || "Failed to connect wallet");
      }

      const address = requestResult.address;
      setState((prev) => ({
        ...prev,
        address,
        shortAddress: shortenAddress(address),
        isWalletConnected: true,
        isWalletDetected: true,
        isLoading: false,
      }));

      // Sync the connection state with useFreighterIdentity's shared store
      // so other components (like AppSidebar) see the updated wallet state immediately
      await refreshIdentityStore();

      trackAuthEvent("connect_wallet", "success", { connected: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect wallet";
      trackAuthEvent("connect_wallet", "failed", { error: message });
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, []);

  const authenticate = useCallback(async () => {
    if (!state.address) {
      setState((prev) => ({
        ...prev,
        error: "Wallet not connected",
      }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      trackAuthEvent("authenticate", "started");
      const { challenge } = await api.auth.challenge(state.address);

      const signResult = await signMessage(challenge, {
        address: state.address,
      });

      if (signResult.error !== undefined) {
        throw new Error(signResult.error.message || "Failed to sign challenge");
      }

      const signedMessage = signResult.signedMessage;
      if (!signedMessage) {
        throw new Error("No signed message returned");
      }
      const signedChallenge = typeof signedMessage === "string" 
        ? signedMessage 
        : Buffer.from(signedMessage).toString("base64url");
      await api.auth.verify(state.address, signedChallenge);

      setState((prev) => ({
        ...prev,
        token: AUTHENTICATED_SESSION,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      }));
      trackAuthEvent("authenticate", "success", { authenticated: true });
    } catch (error) {
      let errorMessage = "Authentication failed";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      trackAuthEvent("authenticate", "failed", { error: errorMessage });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, [state.address]);

  const logout = useCallback(async () => {
    if (state.isAuthenticated) {
      try {
        await api.auth.logout();
      } catch (error) {
        console.error('Logout request failed:', error);
      }
    }

    setState((prev) => ({
      ...prev,
      token: null,
      isAuthenticated: false,
      error: null,
    }));
    trackAuthEvent("logout", "success");
  }, [state.isAuthenticated]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const value = useMemo<AuthContextType>(
    () => ({
      ...state,
      connectWallet,
      authenticate,
      logout,
      refreshAuth,
    }),
    [state, connectWallet, authenticate, logout, refreshAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
