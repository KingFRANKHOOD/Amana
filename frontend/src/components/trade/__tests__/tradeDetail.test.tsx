import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TradeDetail, TradeParty, TimelineEvent, TransactionEvent } from "@/types/trade";

// ── Component imports ──────────────────────────────────────────────────────
import { TradeHeader } from "../TradeHeader";
import { PartiesPanel } from "../PartiesPanel";
import { FinancialSummary } from "../FinancialSummary";
import { TradeTimeline } from "../TradeTimeline";
import { TransactionTimeline } from "../TransactionTimeline";
import { ContractInfo } from "../ContractInfo";
import { ActionBar } from "../ActionBar";
import { TradeDetailPanel } from "../TradeDetailPanel";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/components/ui/WalletAddressBadge", () => ({
  WalletAddressBadge: ({ address }: { address: string }) => (
    <span data-testid="wallet-badge">{address}</span>
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────
const mockBuyer: TradeParty = {
  name: "Alice Buyer",
  walletAddress: "GABC1234567890BUYER",
  trustScore: 80,
};

const mockSeller: TradeParty = {
  name: "Bob Seller",
  walletAddress: "GXYZ1234567890SELLER",
  trustScore: 60,
};

const mockTimeline: TimelineEvent[] = [
  {
    id: "evt-1",
    type: "escrow_funded",
    title: "Escrow Funded",
    status: "completed",
    timestamp: "Jan 1, 2026",
  },
  {
    id: "evt-2",
    type: "dispatched",
    title: "Dispatched",
    status: "current",
    description: "Goods dispatched from origin",
    timestamp: "Jan 5, 2026",
  },
  {
    id: "evt-3",
    type: "settlement",
    title: "Settlement",
    status: "pending",
  },
];

const mockTxTimeline: TransactionEvent[] = [
  { id: "tx-1", title: "Escrow Created", actor: "system", timestamp: "Jan 1" },
  { id: "tx-2", title: "Buyer Confirmed", actor: "buyer", timestamp: "Jan 2" },
  { id: "tx-3", title: "Funds Released", actor: "seller" },
];

const mockTrade: TradeDetail = {
  id: "TRADE-001",
  commodity: "Wheat",
  quantity: "20 Tons Non-GMO",
  category: "Grains / Legumes",
  status: "IN TRANSIT",
  initiatedAt: "Jan 1, 2026",
  buyer: mockBuyer,
  seller: mockSeller,
  vaultAmountLocked: 5000,
  assetValue: 4800,
  platformFeePercent: 1.5,
  platformFee: 72,
  networkGasEst: "0.001",
  contractId: "CONTRACT-XYZ",
  incoterms: "FOB",
  originPort: "Lagos",
  destinationPort: "Rotterdam",
  eta: "Feb 15, 2026",
  carrier: "Maersk",
  timeline: mockTimeline,
  transactionTimeline: mockTxTimeline,
  currentTransactionIndex: 1,
};

// ══════════════════════════════════════════════════════════════════════════
// TradeHeader
// ══════════════════════════════════════════════════════════════════════════
describe("TradeHeader", () => {
  it("renders trade quantity and commodity", () => {
    render(<TradeHeader trade={mockTrade} />);
    expect(screen.getByText("20 Tons Non-GMO Wheat")).toBeInTheDocument();
  });

  it("renders trade ID in breadcrumb", () => {
    render(<TradeHeader trade={mockTrade} />);
    expect(screen.getByText("TRADE-001")).toBeInTheDocument();
  });

  it("renders status badge for IN TRANSIT", () => {
    render(<TradeHeader trade={mockTrade} />);
    expect(screen.getByText("IN TRANSIT")).toBeInTheDocument();
  });

  it("renders correct status badge color for DISPUTED", () => {
    const trade = { ...mockTrade, status: "DISPUTED" as const };
    render(<TradeHeader trade={trade} />);
    const badge = screen.getByText("DISPUTED");
    expect(badge.className).toMatch(/status-danger/);
  });

  it("renders correct status badge color for SETTLED", () => {
    const trade = { ...mockTrade, status: "SETTLED" as const };
    render(<TradeHeader trade={trade} />);
    const badge = screen.getByText("SETTLED");
    expect(badge.className).toMatch(/status-info/);
  });

  it("renders correct status badge color for PENDING", () => {
    const trade = { ...mockTrade, status: "PENDING" as const };
    render(<TradeHeader trade={trade} />);
    const badge = screen.getByText("PENDING");
    expect(badge.className).toMatch(/status-warning/);
  });

  it("renders correct status badge color for DRAFT", () => {
    const trade = { ...mockTrade, status: "DRAFT" as const };
    render(<TradeHeader trade={trade} />);
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
  });

  it("renders initiated date", () => {
    render(<TradeHeader trade={mockTrade} />);
    expect(screen.getByText(/Initiated Jan 1, 2026/)).toBeInTheDocument();
  });

  it("renders category tag", () => {
    render(<TradeHeader trade={mockTrade} />);
    expect(screen.getByText("Grains / Legumes")).toBeInTheDocument();
  });

  it("renders View Contract and Confirm Delivery buttons", () => {
    render(<TradeHeader trade={mockTrade} />);
    expect(screen.getByText("View Contract")).toBeInTheDocument();
    expect(screen.getByText("Confirm Delivery")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PartiesPanel
// ══════════════════════════════════════════════════════════════════════════
describe("PartiesPanel", () => {
  it("renders buyer and seller names", () => {
    render(<PartiesPanel buyer={mockBuyer} seller={mockSeller} />);
    expect(screen.getByText("Alice Buyer")).toBeInTheDocument();
    expect(screen.getByText("Bob Seller")).toBeInTheDocument();
  });

  it("renders THE BUYER and THE SELLER role labels", () => {
    render(<PartiesPanel buyer={mockBuyer} seller={mockSeller} />);
    expect(screen.getByText("THE BUYER")).toBeInTheDocument();
    expect(screen.getByText("THE SELLER")).toBeInTheDocument();
  });

  it("renders wallet address badges for both parties", () => {
    render(<PartiesPanel buyer={mockBuyer} seller={mockSeller} />);
    const badges = screen.getAllByTestId("wallet-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("GABC1234567890BUYER");
    expect(badges[1]).toHaveTextContent("GXYZ1234567890SELLER");
  });

  it("renders trust scores", () => {
    render(<PartiesPanel buyer={mockBuyer} seller={mockSeller} />);
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("renders avatar initial when no avatar url provided", () => {
    render(<PartiesPanel buyer={mockBuyer} seller={mockSeller} />);
    expect(screen.getByText("A")).toBeInTheDocument(); // Alice
    expect(screen.getByText("B")).toBeInTheDocument(); // Bob
  });

  it("renders avatar image when url is provided", () => {
    const buyerWithAvatar = { ...mockBuyer, avatar: "https://example.com/avatar.png" };
    render(<PartiesPanel buyer={buyerWithAvatar} seller={mockSeller} />);
    const img = screen.getByAltText("Alice Buyer");
    expect(img).toHaveAttribute("src", "https://example.com/avatar.png");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// FinancialSummary
// ══════════════════════════════════════════════════════════════════════════
describe("FinancialSummary", () => {
  it("renders Financial Summary heading", () => {
    render(<FinancialSummary trade={mockTrade} />);
    expect(screen.getByText("Financial Summary")).toBeInTheDocument();
  });

  it("renders asset value", () => {
    render(<FinancialSummary trade={mockTrade} />);
    expect(screen.getByText("4,800 USDC")).toBeInTheDocument();
  });

  it("renders platform fee with percentage label", () => {
    render(<FinancialSummary trade={mockTrade} />);
    expect(screen.getByText(/Platform Fee \(1\.5%\)/)).toBeInTheDocument();
    expect(screen.getByText("72 USDC")).toBeInTheDocument();
  });

  it("renders network gas estimate", () => {
    render(<FinancialSummary trade={mockTrade} />);
    expect(screen.getByText("0.001 ETH")).toBeInTheDocument();
  });

  it("renders smart contract secured badge", () => {
    render(<FinancialSummary trade={mockTrade} />);
    expect(screen.getByText("SMART CONTRACT SECURED")).toBeInTheDocument();
  });

  it("renders vault amount locked label", () => {
    render(<FinancialSummary trade={mockTrade} />);
    expect(screen.getByText("Vault Amount Locked")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TradeTimeline
// ══════════════════════════════════════════════════════════════════════════
describe("TradeTimeline", () => {
  it("renders all timeline event titles", () => {
    render(<TradeTimeline events={mockTimeline} />);
    expect(screen.getByText("Escrow Funded")).toBeInTheDocument();
    expect(screen.getByText("Dispatched")).toBeInTheDocument();
    expect(screen.getByText("Settlement")).toBeInTheDocument();
  });

  it("renders CURRENT STATE badge for current event", () => {
    render(<TradeTimeline events={mockTimeline} />);
    expect(screen.getByText("CURRENT STATE")).toBeInTheDocument();
  });

  it("renders event timestamps", () => {
    render(<TradeTimeline events={mockTimeline} />);
    expect(screen.getByText("Jan 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jan 5, 2026")).toBeInTheDocument();
  });

  it("renders event description when provided", () => {
    render(<TradeTimeline events={mockTimeline} />);
    expect(screen.getByText("Goods dispatched from origin")).toBeInTheDocument();
  });

  it("renders events in correct order", () => {
    render(<TradeTimeline events={mockTimeline} />);
    const titles = screen
      .getAllByText(/Escrow Funded|Dispatched|Settlement/)
      .map((el) => el.textContent);
    expect(titles[0]).toBe("Escrow Funded");
    expect(titles[1]).toBe("Dispatched");
    expect(titles[2]).toBe("Settlement");
  });

  it("renders tracking card when tracking data is present", () => {
    const eventsWithTracking: TimelineEvent[] = [
      {
        ...mockTimeline[1],
        tracking: { trackingNumber: "TRK-9999" },
      },
    ];
    render(<TradeTimeline events={eventsWithTracking} />);
    expect(screen.getByText("Tracking #: TRK-9999")).toBeInTheDocument();
  });

  it("renders empty list without crashing", () => {
    const { container } = render(<TradeTimeline events={[]} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TransactionTimeline
// ══════════════════════════════════════════════════════════════════════════
describe("TransactionTimeline", () => {
  it("renders all transaction event titles", () => {
    render(<TransactionTimeline events={mockTxTimeline} currentEventIndex={1} />);
    expect(screen.getByText("Escrow Created")).toBeInTheDocument();
    expect(screen.getByText("Buyer Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Funds Released")).toBeInTheDocument();
  });

  it("renders Transaction Timeline heading", () => {
    render(<TransactionTimeline events={mockTxTimeline} currentEventIndex={0} />);
    expect(screen.getByText("Transaction Timeline")).toBeInTheDocument();
  });

  it("renders Active badge for current event", () => {
    render(<TransactionTimeline events={mockTxTimeline} currentEventIndex={1} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders empty list without crashing", () => {
    const { container } = render(
      <TransactionTimeline events={[]} currentEventIndex={0} />
    );
    expect(container.firstChild).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ContractInfo
// ══════════════════════════════════════════════════════════════════════════
describe("ContractInfo", () => {
  it("renders contract ID", () => {
    render(<ContractInfo trade={mockTrade} />);
    expect(screen.getByText("CONTRACT-XYZ")).toBeInTheDocument();
  });

  it("renders incoterms", () => {
    render(<ContractInfo trade={mockTrade} />);
    expect(screen.getByText("FOB")).toBeInTheDocument();
  });

  it("renders origin and destination ports", () => {
    render(<ContractInfo trade={mockTrade} />);
    expect(screen.getByText("Lagos")).toBeInTheDocument();
    expect(screen.getAllByText("Rotterdam").length).toBeGreaterThan(0);
  });

  it("renders carrier", () => {
    render(<ContractInfo trade={mockTrade} />);
    expect(screen.getByText("Maersk")).toBeInTheDocument();
  });

  it("renders buyer and seller wallet badges", () => {
    render(<ContractInfo trade={mockTrade} />);
    const badges = screen.getAllByTestId("wallet-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("renders loss ratio bars when provided", () => {
    const tradeWithRatios = {
      ...mockTrade,
      lossRatios: [
        { label: "Moisture Loss", value: 12 },
        { label: "Transit Damage", value: 45 },
      ],
    };
    render(<ContractInfo trade={tradeWithRatios} />);
    expect(screen.getByText("Moisture Loss")).toBeInTheDocument();
    expect(screen.getByText("Transit Damage")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("does not render loss ratio section when not provided", () => {
    render(<ContractInfo trade={mockTrade} />);
    expect(screen.queryByText("Loss Ratios")).not.toBeInTheDocument();
  });

  it("renders etaLabel when provided", () => {
    const tradeWithEtaLabel = { ...mockTrade, etaLabel: "~3 weeks" };
    render(<ContractInfo trade={tradeWithEtaLabel} />);
    expect(screen.getByText("ETA: ~3 weeks")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ActionBar
// ══════════════════════════════════════════════════════════════════════════
describe("ActionBar", () => {
  const onConfirmDelivery = jest.fn();

  beforeEach(() => onConfirmDelivery.mockClear());

  it("shows Raise Dispute and Confirm Delivery for IN TRANSIT status", () => {
    render(
      <ActionBar
        trade={mockTrade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    expect(screen.getByText("Raise Dispute")).toBeInTheDocument();
    expect(screen.getByText("Confirm Delivery")).toBeInTheDocument();
  });

  it("shows Raise Dispute for PENDING status", () => {
    const trade = { ...mockTrade, status: "PENDING" as const };
    render(
      <ActionBar
        trade={trade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    expect(screen.getByText("Raise Dispute")).toBeInTheDocument();
  });

  it("hides Confirm Delivery for PENDING status", () => {
    const trade = { ...mockTrade, status: "PENDING" as const };
    render(
      <ActionBar
        trade={trade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    expect(screen.queryByText("Confirm Delivery")).not.toBeInTheDocument();
  });

  it("shows Release Funds for SETTLED status", () => {
    const trade = { ...mockTrade, status: "SETTLED" as const };
    render(
      <ActionBar
        trade={trade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    expect(screen.getByText("Release Funds")).toBeInTheDocument();
  });

  it("hides all action buttons for DISPUTED status", () => {
    const trade = { ...mockTrade, status: "DISPUTED" as const };
    render(
      <ActionBar
        trade={trade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    expect(screen.queryByText("Raise Dispute")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm Delivery")).not.toBeInTheDocument();
    expect(screen.queryByText("Release Funds")).not.toBeInTheDocument();
  });

  it("calls onConfirmDelivery when Confirm Delivery is clicked", () => {
    render(
      <ActionBar
        trade={mockTrade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    fireEvent.click(screen.getByText("Confirm Delivery"));
    expect(onConfirmDelivery).toHaveBeenCalledTimes(1);
  });

  it("disables Confirm Delivery button when confirmingDelivery is true", () => {
    render(
      <ActionBar
        trade={mockTrade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={true}
      />
    );
    const btn = screen.getByText("Confirming…").closest("button");
    expect(btn).toBeDisabled();
  });

  it("shows PoD Verification button for IN TRANSIT", () => {
    render(
      <ActionBar
        trade={mockTrade}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />
    );
    expect(screen.getByText("PoD Verification")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TradeDetailPanel (orchestration)
// ══════════════════════════════════════════════════════════════════════════
describe("TradeDetailPanel", () => {
  it("renders without crashing with full trade data", () => {
    const { container } = render(<TradeDetailPanel trade={mockTrade} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("renders TradeHeader section", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("20 Tons Non-GMO Wheat")).toBeInTheDocument();
  });

  it("renders PartiesPanel section", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("Trade Parties")).toBeInTheDocument();
  });

  it("renders FinancialSummary section", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("Financial Summary")).toBeInTheDocument();
  });

  it("renders TradeTimeline section", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("Trade Lifecycle")).toBeInTheDocument();
  });

  it("renders TransactionTimeline when provided", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("Transaction Timeline")).toBeInTheDocument();
  });

  it("does not render TransactionTimeline when not provided", () => {
    const trade = { ...mockTrade, transactionTimeline: undefined };
    render(<TradeDetailPanel trade={trade} />);
    expect(screen.queryByText("Transaction Timeline")).not.toBeInTheDocument();
  });

  it("renders ContractInfo section", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("Contract Details")).toBeInTheDocument();
  });

  it("renders ActionBar", () => {
    render(<TradeDetailPanel trade={mockTrade} />);
    expect(screen.getByText("Raise Dispute")).toBeInTheDocument();
  });
});
