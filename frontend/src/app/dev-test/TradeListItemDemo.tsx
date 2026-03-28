"use client";

import { useState } from "react";
import { TradeListItem } from "@/components/trade/TradeListItem";
import type { TradeStatus } from "@/types/trade";

const SAMPLE_TRADES: {
  tradeId: string;
  commodity: string;
  counterparty: { role: string; address: string };
  amountUsdc: string;
  status: TradeStatus;
  createdAt: string;
  showDeposit?: boolean;
  showWithdraw?: boolean;
}[] = [
  {
    tradeId: "TRD-0001",
    commodity: "20 Tons Non-GMO Soybeans",
    counterparty: {
      role: "Buyer",
      address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    },
    amountUsdc: "42,500.00",
    status: "IN TRANSIT",
    createdAt: "24 Mar 2026",
    showDeposit: true,
  },
  {
    tradeId: "TRD-0002",
    commodity: "5 Tons Organic Cocoa Beans",
    counterparty: {
      role: "Seller",
      address: "GBVFLWI4BHEFNREUZ7MWKUKGEBV5PFP5TLHZGXQJQKSKFEXOFAGXFBXS",
    },
    amountUsdc: "18,750.00",
    status: "PENDING",
    createdAt: "25 Mar 2026",
    showDeposit: true,
  },
  {
    tradeId: "TRD-0003",
    commodity: "10 Tons Arabica Coffee",
    counterparty: {
      role: "Buyer",
      address: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGMAKZ93KNFZ7ID2AWRXNZ",
    },
    amountUsdc: "31,200.00",
    status: "SETTLED",
    createdAt: "20 Mar 2026",
    showWithdraw: true,
  },
  {
    tradeId: "TRD-0004",
    commodity: "15 Tons White Maize",
    counterparty: {
      role: "Seller",
      address: "GDNSSYSCSSJ3LNZMBQ5SXLLFJFQF7NZXMTNJHEMR5DJXZXP7X4PJBFE",
    },
    amountUsdc: "9,800.00",
    status: "DISPUTED",
    createdAt: "22 Mar 2026",
  },
  {
    tradeId: "TRD-0005",
    commodity: "3 Tons Shea Butter",
    counterparty: {
      role: "Buyer",
      address: "GBWZFKQLHQNVADIMRMFXRV7GKPXSB4LLHMVB7U3PXMRX2XNJWLZXKOA",
    },
    amountUsdc: "7,250.00",
    status: "DRAFT",
    createdAt: "28 Mar 2026",
  },
];

export function TradeListItemDemo() {
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <div>
      <div className="max-w-3xl">
        {SAMPLE_TRADES.map((t) => (
          <TradeListItem
            key={t.tradeId}
            tradeId={t.tradeId}
            commodity={t.commodity}
            counterparty={t.counterparty}
            amountUsdc={t.amountUsdc}
            status={t.status}
            createdAt={t.createdAt}
            onView={() => setLastAction(`View → ${t.tradeId}`)}
            onDeposit={
              t.showDeposit
                ? () => setLastAction(`Deposit → ${t.tradeId}`)
                : undefined
            }
            onWithdraw={
              t.showWithdraw
                ? () => setLastAction(`Withdraw → ${t.tradeId}`)
                : undefined
            }
          />
        ))}
      </div>

      {lastAction && (
        <p className="mt-4 text-xs font-mono text-teal">
          Last action: <span className="text-text-primary">{lastAction}</span>
        </p>
      )}
    </div>
  );
}
