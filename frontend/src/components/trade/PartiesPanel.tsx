"use client";

import React from "react";
import { Star } from "lucide-react";
import type { TradeParty } from "@/types/trade";

interface PartiesPanelProps {
  buyer: TradeParty;
  seller: TradeParty;
}

function PartyCard({
  party,
  role,
}: {
  party: TradeParty;
  role: "BUYER" | "SELLER";
}) {
  const truncateWallet = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  return (
    <div className="flex-1 bg-elevated rounded-lg p-4 border border-border-default">
      <p className="text-xs font-semibold tracking-widest text-text-muted mb-3">
        THE {role}
      </p>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-default flex items-center justify-center text-lg flex-shrink-0">
          {party.avatar ? (
            <img
              src={party.avatar}
              alt={party.name}
              className="w-full h-full rounded-lg object-cover"
            />
          ) : (
            <span className="text-text-muted">{party.name[0]}</span>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-text-primary font-semibold text-sm truncate">
            {party.name}
          </p>
          <p className="text-text-muted text-xs font-mono mt-0.5">
            {truncateWallet(party.walletAddress)}
          </p>
        </div>
      </div>

      {/* Trust Score */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-default">
        <span className="text-xs text-text-muted">Trust Score</span>
        <div className="flex items-center gap-1.5">
          <span className="text-emerald font-bold text-sm">{party.trustScore}</span>
          <div className="flex gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${
                  i < Math.round(party.trustScore / 20)
                    ? "text-gold fill-gold"
                    : "text-text-muted"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PartiesPanel({ buyer, seller }: PartiesPanelProps) {
  return (
    <div className="bg-card rounded-xl border border-border-default p-6 shadow-card">
      <h2 className="text-sm font-semibold text-text-secondary mb-4 tracking-wide uppercase">
        Trade Parties
      </h2>
      <div className="flex flex-col sm:flex-row gap-4">
        <PartyCard party={buyer} role="BUYER" />

        {/* Connector */}
        <div className="hidden sm:flex flex-col items-center justify-center gap-1 px-2">
          <div className="w-px h-8 bg-border-default" />
          <div className="w-6 h-6 rounded-full bg-elevated border border-border-default flex items-center justify-center">
            <svg className="w-3 h-3 text-text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6h8M6 2l4 4-4 4" />
            </svg>
          </div>
          <div className="w-px h-8 bg-border-default" />
        </div>

        <PartyCard party={seller} role="SELLER" />
      </div>
    </div>
  );
}
