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

const TOKEN_STORAGE_KEY = "amana_jwt";

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

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp;
    if (!exp) return true;
    return Date.now() >= exp * 1000;
  } catch {
    return true;
  }
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
    } catch {
      return { hasWallet: false, hasPermission: false, address: null };
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { hasWallet, hasPermission, address } = await checkWalletState();
      const storedToken = getStoredToken();

      let token: string | null = null;
      let isAuthenticated = false;

      if (storedToken && !isTokenExpired(storedToken)) {
        token = storedToken;
        isAuthenticated = true;
      }

      setState({
        address,
        shortAddress: address ? shortenAddress(address) : null,
        token,
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
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to connect wallet",
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
      const { token } = await api.auth.verify(state.address, signedChallenge);

      setStoredToken(token);

      setState((prev) => ({
        ...prev,
        token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      }));
    } catch (error) {
      let errorMessage = "Authentication failed";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, [state.address]);

  const logout = useCallback(async () => {
    if (state.token) {
      try {
        await api.auth.logout(state.token);
      } catch {
        // Ignore logout errors
      }
    }

    clearStoredToken();

    setState((prev) => ({
      ...prev,
      token: null,
      isAuthenticated: false,
      error: null,
    }));
  }, [state.token]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!state.token) return;

    const payload = JSON.parse(atob(state.token.split(".")[1]));
    const exp = payload.exp;
    if (!exp) return;

    const expiresIn = exp * 1000 - Date.now();
    if (expiresIn <= 0) {
      clearStoredToken();
      setState((prev) => ({
        ...prev,
        token: null,
        isAuthenticated: false,
      }));
      return;
    }

    const refreshBuffer = 60 * 1000;
    const timeout = setTimeout(() => {
      clearStoredToken();
      setState((prev) => ({
        ...prev,
        token: null,
        isAuthenticated: false,
        error: "Session expired. Please authenticate again.",
      }));
    }, expiresIn - refreshBuffer);

    return () => clearTimeout(timeout);
  }, [state.token]);

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
