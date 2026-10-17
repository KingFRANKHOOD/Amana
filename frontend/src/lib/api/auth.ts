import { request } from "./client";
import type { ChallengeResponse, SessionResponse, ValidateSessionResponse } from "./types";

export const authApi = {
  challenge: (walletAddress: string) =>
    request<ChallengeResponse>("/auth/challenge", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ walletAddress }),
    }),

  verify: (walletAddress: string, signedChallenge: string) =>
    request<SessionResponse>("/auth/verify", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ walletAddress, signedChallenge }),
    }),

  logout: () =>
    request<{ message: string }>("/auth/logout", {
      method: "POST",
    }),

  refresh: () =>
    request<SessionResponse>("/auth/refresh", {
      method: "POST",
      skipAuth: true,
    }),

  validate: () => request<ValidateSessionResponse>("/auth/validate"),
};
