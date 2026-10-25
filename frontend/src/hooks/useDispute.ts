"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type DisputeResponse, type EvidenceRecord } from "@/lib/api";
import { useAuth } from "./useAuth";

interface UseDisputeResult {
  dispute: DisputeResponse | null;
  evidence: EvidenceRecord[];
  isLoading: boolean;
  error: string | null;
  submitEvidence: (file: File) => Promise<void>;
  resolveDispute: (sellerGetsBps: number) => Promise<string>;
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function useDispute(tradeId: string): UseDisputeResult {
  const { token, isAuthenticated } = useAuth();
  const [dispute, setDispute] = useState<DisputeResponse | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchDispute = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const [disputeData, evidenceData] = await Promise.all([
        api.disputes.get(token, tradeId),
        api.trades.getEvidence(token, tradeId),
      ]);
      if (requestId !== requestIdRef.current) return;
      setDispute(disputeData);
      setEvidence(evidenceData.evidence);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(toErrorMessage(err, "Failed to load dispute"));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [token, isAuthenticated, tradeId]);

  useEffect(() => {
    void fetchDispute();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchDispute]);

  const submitEvidence = useCallback(
    async (file: File) => {
      if (!token) {
        throw new Error("Not authenticated");
      }

      setError(null);

      try {
        await api.trades.uploadEvidence(token, tradeId, file);
        const evidenceData = await api.trades.getEvidence(token, tradeId);
        setEvidence(evidenceData.evidence);
      } catch (err) {
        const message = toErrorMessage(err, "Failed to upload evidence");
        setError(message);
        throw err;
      }
    },
    [token, tradeId],
  );

  const resolveDispute = useCallback(
    async (sellerGetsBps: number) => {
      if (!token) {
        throw new Error("Not authenticated");
      }

      setError(null);

      try {
        const { unsignedXdr } = await api.disputes.resolve(token, tradeId, {
          sellerGetsBps,
        });
        return unsignedXdr;
      } catch (err) {
        const message = toErrorMessage(err, "Failed to resolve dispute");
        setError(message);
        throw err;
      }
    },
    [token, tradeId],
  );

  return { dispute, evidence, isLoading, error, submitEvidence, resolveDispute };
}
