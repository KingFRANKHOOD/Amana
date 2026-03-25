"use client";

import {
  VaultHero,
  ReleaseSequenceCard,
  VaultValueCard,
  ContractManifestCard,
  AuditLogCard,
  NetworkBackboneCard,
  VaultFooter,
} from "@/components/vault";

// Mock data - in production, this would come from an API or database
const VAULT_DATA = {
  escrowId: "8492-AX",
  custodyType: "Institutional Custody",
  status: "Funds Locked",
  isSecured: true,
  sequenceId: "882-AF",
  steps: [
    { label: "Agreement", date: "Oct 12, 2023", status: "completed" as const },
    { label: "Audit Phase", date: "Processing...", status: "in-progress" as const },
    { label: "Final Release", date: "Est. Nov 04", status: "pending" as const },
  ],
  vaultValue: 2480000,
  currency: "USD",
  isInsured: true,
  contract: {
    id: "AMN-772-VLT-09",
    agreementDate: "September 24, 2023",
    settlementType: "Immediate / Fiat-Backed",
    originParty: {
      initials: "GB",
      name: "Global Biotech Inc.",
      color: "teal" as const,
    },
    recipientParty: {
      initials: "NS",
      name: "Nova Solutions Ltd.",
      color: "emerald" as const,
    },
  },
  auditLog: [
    {
      type: "biometric" as const,
      title: "Biometric validation passed",
      metadata: "2m ago • 192.168.1.44",
    },
    {
      type: "multi-sig" as const,
      title: "Multi-sig request broadcast",
      metadata: "1h ago • ID: 494022",
    },
    {
      type: "ledger" as const,
      title: "Ledger synchronization",
      metadata: "Yesterday • Block 182,990",
    },
  ],
  networkDescription:
    "Secured and powered by the Stellar network for instantaneous cross-border settlement and verifiable transparency.",
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
            <AuditLogCard entries={VAULT_DATA.auditLog} isLiveSync />
          </div>

          {/* Row 3: Network Backbone (full width) */}
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
