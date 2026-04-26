import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { TradeDetailPanel } from "../TradeDetailPanel";
import { TradeHeader } from "../TradeHeader";
import { PartiesPanel } from "../PartiesPanel";
import { FinancialSummary } from "../FinancialSummary";
import { TradeTimeline } from "../TradeTimeline";
import { TransactionTimeline } from "../TransactionTimeline";
import { ContractInfo } from "../ContractInfo";
import { ActionBar } from "../ActionBar";
import type { TradeDetail, TradeStatus } from "@/types/trade";

jest.mock("next/link", () => {
  function MockNextLink({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  }

  MockNextLink.displayName = "MockNextLink";
  return MockNextLink;
});

const baseTrade: TradeDetail = {
  id: "TRD-12345",
  commodity: "Soybeans",
  quantity: "20 Tons",
  category: "Grains",
  status: "IN TRANSIT",
  initiatedAt: "Apr 20, 2026",
  buyer: {
    name: "Acme Buyer",
    walletAddress: "GBCBUYER000000000000000000000000000000000000000000000001",
    trustScore: 88,
  },
  seller: {
    name: "Delta Seller",
    walletAddress: "GBCSELLER00000000000000000000000000000000000000000000001",
    trustScore: 94,
  },
  vaultAmountLocked: 25000,
  assetValue: 24000,
  platformFeePercent: 2,
  platformFee: 480,
  networkGasEst: "0.013",
  contractId: "AMN-CTR-11",
  incoterms: "FOB",
  originPort: "Lagos",
  destinationPort: "Tema",
  eta: "May 1, 2026",
  etaLabel: "7 days",
  carrier: "Swift Logistics",
  timeline: [
    {
      id: "1",
      type: "escrow_funded",
      title: "Escrow funded",
      status: "completed",
      timestamp: "09:00",
    },
    {
      id: "2",
      type: "dispatched",
      title: "Cargo dispatched",
      status: "current",
      description: "Shipment departed origin port.",
      tracking: { trackingNumber: "TRK-001" },
    },
    {
      id: "3",
      type: "settlement",
      title: "Settlement",
      status: "pending",
    },
  ],
  transactionTimeline: [
    { id: "tx1", title: "Escrow Created", actor: "system", timestamp: "08:00" },
    { id: "tx2", title: "Shipment Confirmed", actor: "seller", timestamp: "09:00" },
    { id: "tx3", title: "Funds Released", actor: "buyer", timestamp: "10:00" },
  ],
  currentTransactionIndex: 1,
  lossRatios: [
    { label: "Delay risk", value: 30 },
    { label: "Quality risk", value: 20 },
  ],
};

describe("trade detail component coverage", () => {
  it("renders TradeDetailPanel with all major sections", () => {
    render(<TradeDetailPanel trade={baseTrade} />);

    expect(screen.getByText("Trade Lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Trade Parties")).toBeInTheDocument();
    expect(screen.getByText("Financial Summary")).toBeInTheDocument();
    expect(screen.getByText("Contract Details")).toBeInTheDocument();
    expect(screen.getByText("Transaction Timeline")).toBeInTheDocument();
  });

  it("renders TradeHeader status variants with fallback style", () => {
    const statuses: TradeStatus[] = ["IN TRANSIT", "PENDING", "SETTLED", "DISPUTED", "DRAFT"];
    statuses.forEach((status) => {
      const { unmount } = render(<TradeHeader trade={{ ...baseTrade, status }} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    });
  });

  it("renders PartiesPanel with buyer and seller identities", () => {
    render(<PartiesPanel buyer={baseTrade.buyer} seller={baseTrade.seller} />);

    expect(screen.getByText("Acme Buyer")).toBeInTheDocument();
    expect(screen.getByText("Delta Seller")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Copy wallet address")).toHaveLength(2);
  });

  it("renders FinancialSummary values and fee breakdown", () => {
    render(<FinancialSummary trade={baseTrade} />);

    expect(screen.getByText("Vault Amount Locked")).toBeInTheDocument();
    expect(screen.getByText("Asset Value")).toBeInTheDocument();
    expect(screen.getByText("Platform Fee (2%)")).toBeInTheDocument();
    expect(screen.getByText("SMART CONTRACT SECURED")).toBeInTheDocument();
  });

  it("renders timeline events in declared order", () => {
    render(<TradeTimeline events={baseTrade.timeline} />);

    const titles = screen.getAllByText(/Escrow funded|Cargo dispatched|Settlement/);
    expect(titles[0]).toHaveTextContent("Escrow funded");
    expect(titles[1]).toHaveTextContent("Cargo dispatched");
    expect(titles[2]).toHaveTextContent("Settlement");
    expect(screen.getByText("CURRENT STATE")).toBeInTheDocument();
  });

  it("renders TransactionTimeline with active marker on current event", () => {
    render(
      <TransactionTimeline
        events={baseTrade.transactionTimeline ?? []}
        currentEventIndex={1}
      />,
    );

    expect(screen.getByText("Escrow Created")).toBeInTheDocument();
    expect(screen.getByText("Shipment Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Funds Released")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders ContractInfo metadata and loss ratio bars", () => {
    render(<ContractInfo trade={baseTrade} />);

    expect(screen.getByText("AMN-CTR-11")).toBeInTheDocument();
    expect(screen.getByText("Delay risk")).toBeInTheDocument();
    expect(screen.getByText("Quality risk")).toBeInTheDocument();
    expect(screen.getAllByText("Tema").length).toBeGreaterThan(0);
  });

  it("hides and shows ActionBar buttons based on trade status", async () => {
    const user = userEvent.setup();
    const onConfirmDelivery = jest.fn();
    const { rerender } = render(
      <ActionBar
        trade={{ ...baseTrade, status: "PENDING" }}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />,
    );

    expect(screen.getByText("Raise Dispute")).toBeInTheDocument();
    expect(screen.queryByText("Confirm Delivery")).not.toBeInTheDocument();
    expect(screen.queryByText("Release Funds")).not.toBeInTheDocument();

    rerender(
      <ActionBar
        trade={{ ...baseTrade, status: "IN TRANSIT" }}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />,
    );
    await user.click(screen.getByText("Confirm Delivery"));
    expect(onConfirmDelivery).toHaveBeenCalledTimes(1);

    rerender(
      <ActionBar
        trade={{ ...baseTrade, status: "SETTLED" }}
        onConfirmDelivery={onConfirmDelivery}
        confirmingDelivery={false}
      />,
    );
    expect(screen.getByText("Release Funds")).toBeInTheDocument();
    expect(screen.queryByText("Raise Dispute")).not.toBeInTheDocument();
  });

  it("renders without optional timelines", () => {
    render(
      <TradeDetailPanel
        trade={{ ...baseTrade, transactionTimeline: undefined, lossRatios: undefined }}
      />,
    );
    expect(screen.queryByText("Transaction Timeline")).not.toBeInTheDocument();
    expect(screen.getByText("Contract Details")).toBeInTheDocument();
  });
});
