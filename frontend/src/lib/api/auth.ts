import { request } from "./client";
import type { ChallengeResponse, VerifyResponse } from "./types";

export const authApi = {
  challenge: (walletAddress: string) =>
    request<ChallengeResponse>("/auth/challenge", {
      method: "POST",
      body: JSON.stringify({ walletAddress }),
    }),

  verify: (walletAddress: string, signedChallenge: string) =>
    request<VerifyResponse>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ walletAddress, signedChallenge }),
    }),

  logout: (token: string) =>
    request<{ message: string }>("/auth/logout", {
      method: "POST",
      token,
    }),
};
