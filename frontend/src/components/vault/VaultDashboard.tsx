"use client";

import {
  VaultHero,
  ReleaseSequenceCard,
  VaultValueCard,
  ContractManifestCard,
  AuditLogCard,
  NetworkBackboneCard,
  VaultFooter,
  PaymentOverviewCard,
} from "@/components/vault";

const VAULT_DATA = {
  escrowId: "0-AX",
  custodyType: "Pending Wallet Authorization",
  status: "No Active Trades",
  isSecured: false,
  sequenceId: "0-AF",
  steps: [
    { label: "Agreement", date: "-", status: "completed" as const },
    {
      label: "Audit Phase",
      date: "Coming soon",
      status: "in-progress" as const,
    },
    { label: "Final Release", date: "-", status: "pending" as const },
  ],
  vaultValue: 0,
  currency: "USD",
  isInsured: false,
  contract: {
    id: "No active trades",
    agreementDate: "-",
    settlementType: "Pending",
    originParty: {
      initials: "GB",
      name: "Buyer",
      color: "teal" as const,
    },
    recipientParty: {
      initials: "NS",
      name: "Seller",
      color: "emerald" as const,
    },
  },
  auditLog: [],
  networkDescription:
    "Secured and powered by the Stellar network for instantaneous cross-border settlement and verifiable transparency.",
  paymentOverview: {
    totalCngn: 0,
    ngnRate: 1580,
  },
  footer: {
    version: "V4.8.2",
    links: [
      { label: "Privacy Protocol", href: "#" },
      { label: "Compliance", href: "#" },
      { label: "Audit Report", href: "#" },
    ],
    socialLinks: [
      { platform: "x" as const, href: "#" },
      { platform: "instagram" as const, href: "#" },
      { platform: "tiktok" as const, href: "#" },
      { platform: "discord" as const, href: "#" },
    ],
  },
};

export function VaultDashboard() {
  const handleReleaseFunds = () => {
    // Handle release funds action
  };

  const handleExportPdf = () => {
    // Handle PDF export
  };

  const handleViewClauses = () => {
    // Handle view clauses
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <main className="max-w-7xl mx-auto px-6 py-10">
        <VaultHero
          escrowId={VAULT_DATA.escrowId}
          custodyType={VAULT_DATA.custodyType}
          status={VAULT_DATA.status}
          isSecured={VAULT_DATA.isSecured}
        />

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Row 1: Release Sequence (2 cols) + Vault Value (1 col) */}
          <div className="lg:col-span-8">
            <ReleaseSequenceCard
              sequenceId={VAULT_DATA.sequenceId}
              steps={VAULT_DATA.steps}
            />
          </div>
          <div className="lg:col-span-4">
            <VaultValueCard
              value={VAULT_DATA.vaultValue}
              currency={VAULT_DATA.currency}
              isInsured={VAULT_DATA.isInsured}
              onReleaseFunds={handleReleaseFunds}
            />
          </div>

          {/* Row 2: Contract Manifest (2 cols) + Audit Log (1 col) */}
          <div className="lg:col-span-7">
            <ContractManifestCard
              contractId={VAULT_DATA.contract.id}
              agreementDate={VAULT_DATA.contract.agreementDate}
              settlementType={VAULT_DATA.contract.settlementType}
              originParty={VAULT_DATA.contract.originParty}
              recipientParty={VAULT_DATA.contract.recipientParty}
              onExportPdf={handleExportPdf}
              onViewClauses={handleViewClauses}
            />
          </div>
          <div className="lg:col-span-5">
            <AuditLogCard
              entries={VAULT_DATA.auditLog}
              isLiveSync={false}
              emptyMessage="Vault audit events are not available yet. No security entries are shown until a verified audit source is connected."
            />
          </div>

          {/* Row 3: Payment Overview */}
          <div className="lg:col-span-5">
            <PaymentOverviewCard
              totalCngn={VAULT_DATA.paymentOverview.totalCngn}
              ngnRate={VAULT_DATA.paymentOverview.ngnRate}
            />
          </div>

          {/* Row 4: Network Backbone (full width) */}
          <div className="lg:col-span-12">
            <NetworkBackboneCard description={VAULT_DATA.networkDescription} />
          </div>
        </div>

        <VaultFooter
          version={VAULT_DATA.footer.version}
          links={VAULT_DATA.footer.links}
          socialLinks={VAULT_DATA.footer.socialLinks}
        />
      </main>
    </div>
  );
}
