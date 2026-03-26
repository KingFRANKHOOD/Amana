// src/app/assets/[id]/page.tsx
import { TradeDetailPanel } from "@/components/trade/TradeDetailPanel";
import type { TradeDetail } from "@/types/trade";

// Mock data matching the Figma design
const MOCK_TRADE: TradeDetail = {
  id: "AMN-4920-X",
  commodity: "Non-GMO Soybeans",
  quantity: "20 Tons",
  category: "Grains / Legumes",
  status: "IN TRANSIT",
  initiatedAt: "Oct 24, 2023",

  buyer: {
    name: "AgroTrade Global Ltd",
    walletAddress: "0x73C...3a46",
    trustScore: 99.4,
  },
  seller: {
    name: "Harvester Co-op",
    walletAddress: "0x42A...9F1b",
    trustScore: 98.1,
  },

  vaultAmountLocked: 42000,
  assetValue: 41580,
  platformFeePercent: 1,
  platformFee: 420,
  networkGasEst: "0.02",

  contractId: "CTR-2023-0924",
  incoterms: "CIF",
  originPort: "Port of Rotterdam",
  destinationPort: "Port of Singapore",
  eta: "Oct 30, 2023",
  etaLabel: "5 Days, 12 Hours",
  carrier: "Maersk Line / MS Silver-Oak",

  timeline: [
    {
      id: "1",
      type: "escrow_funded",
      title: "Escrow Funded",
      description:
        "Payment of 42,000 USDC secured in Amana Vault v2. Smart contract verified.",
      timestamp: "Oct 24, 14:20 GMT",
      status: "completed",
    },
    {
      id: "2",
      type: "inspection_passed",
      title: "Quality Inspection Passed",
      description:
        "Certified by SGS Group. Moisture content at 12.5%, purity 99.8%.",
      timestamp: "Oct 25, 09:15 GMT",
      status: "completed",
    },
    {
      id: "3",
      type: "dispatched",
      title: "Goods Dispatched",
      description:
        "Carrier: Maersk Line. Vessel: MS Silver-Oak. Estimated arrival: Oct 30.",
      status: "current",
      tracking: {
        trackingNumber: "M-99230-BB-22",
      },
    },
    {
      id: "4",
      type: "settlement",
      title: "Settlement",
      description:
        "Automatic release of funds upon buyer confirmation or timer expiry.",
      status: "pending",
    },
  ],

  lossRatios: [
    { label: "Transit Loss Risk", value: 8 },
    { label: "Quality Deviation", value: 2 },
    { label: "Counterparty Risk", value: 5 },
  ],
};

export default function TradeDetailPage() {
  return <TradeDetailPanel trade={MOCK_TRADE} />;
}
