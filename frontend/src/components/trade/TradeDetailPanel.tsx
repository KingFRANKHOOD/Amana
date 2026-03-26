"use client";

import React, { useState } from "react";
import { TradeHeader } from "./TradeHeader";
import { PartiesPanel } from "./PartiesPanel";
import { FinancialSummary } from "./FinancialSummary";
import { TradeTimeline } from "./TradeTimeline";
import { ContractInfo } from "./ContractInfo";
import { ActionBar } from "./ActionBar";
import { VaultSidebar } from "./VaultSidebar";
import type { TradeDetail } from "@/types/trade";

interface TradeDetailPanelProps {
  trade: TradeDetail;
}

export function TradeDetailPanel({ trade }: TradeDetailPanelProps) {
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);

  return (
    <div className="min-h-screen bg-primary pb-28">
      {/* Page grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full max-w-7xl mx-auto p-6">

        {/* ── Left column (main) ── */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <TradeHeader trade={trade} />
          <PartiesPanel buyer={trade.buyer} seller={trade.seller} />
          <FinancialSummary trade={trade} />
        </div>

        {/* ── Right column (sidebar) ── */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <VaultSidebar trade={trade} />
          <TradeTimeline events={trade.timeline} />
          <ContractInfo trade={trade} />
        </div>
      </div>

      {/* ── Fixed bottom Action Bar ── */}
      <ActionBar
        trade={trade}
        onConfirmDelivery={() => setConfirmingDelivery(true)}
        confirmingDelivery={confirmingDelivery}
      />
    </div>
  );
}
