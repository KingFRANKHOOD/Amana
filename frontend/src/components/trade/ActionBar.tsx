"use client";

import React from "react";
import type { TradeDetail } from "@/types/trade";

interface ActionBarProps {
  trade: TradeDetail;
  onConfirmDelivery: () => void;
  confirmingDelivery: boolean;
}

export function ActionBar({
  trade,
  onConfirmDelivery,
  confirmingDelivery,
}: ActionBarProps) {
  const showPoDVerification = trade.status === "IN TRANSIT";
  const showRaiseDispute =
    trade.status === "IN TRANSIT" || trade.status === "PENDING";
  const showReleaseFunds = trade.status === "SETTLED";

  return (
    <div className="fixed bottom-0 left-0 w-full bg-card/90 backdrop-blur-md border-t border-border-default p-4 flex justify-end gap-4 z-50">
      {showRaiseDispute && (
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-status-danger/40 text-status-danger text-sm font-semibold hover:bg-status-danger/10 transition-all">
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M8 2v6M8 11v1" strokeLinecap="round" />
            <path d="M2 14L8 2l6 12H2z" />
          </svg>
          Raise Dispute
        </button>
      )}

      {showPoDVerification && (
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border-default text-text-secondary text-sm font-semibold hover:border-border-hover hover:text-text-primary transition-all">
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
            <path d="M5 8l2.5 2.5L11 5.5" />
          </svg>
          PoD Verification
        </button>
      )}

      {showPoDVerification && (
        <button
          onClick={onConfirmDelivery}
          disabled={confirmingDelivery}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-gold-cta text-text-inverse text-sm font-bold hover:shadow-glow-gold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {confirmingDelivery ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M8 2a6 6 0 016 6" />
              </svg>
              Confirming…
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="8" cy="8" r="7" />
                <path d="M5 8l2.5 2.5L11 5.5" />
              </svg>
              Confirm Delivery
            </>
          )}
        </button>
      )}

      {showReleaseFunds && (
        <button className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald text-text-inverse text-sm font-bold hover:shadow-glow-emerald transition-all">
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M8 1v8M5 6l3 3 3-3" />
            <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
          </svg>
          Release Funds
        </button>
      )}
    </div>
  );
}
