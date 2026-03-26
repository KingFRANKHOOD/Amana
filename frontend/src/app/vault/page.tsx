"use client";

import {
  AuditLogCard,
  ContractManifestCard,
  ReleaseSequenceCard,
  VaultFooter,
  VaultHero,
  VaultValueCard,
} from "@/components/vault";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";

const FOOTER_CONTENT = {
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
};

const PARTNERS = [
  "Stellar",
  "Mercury Custody",
  "Afrex Agro",
  "Chainproof",
  "Frontier Trade",
  "SiloBank",
];

function hashToNumber(seed: string): number {
  let hash = 0;

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

export default function VaultPage() {
  const {
    address,
    shortAddress,
    isAuthorized,
    isWalletDetected,
    isLoading,
    connectWallet,
  } = useFreighterIdentity();

  const identitySeed = address ?? "guest";
  const hash = hashToNumber(identitySeed);
  const vaultValue = 1200000 + (hash % 3400000);
  const escrowId = `${(hash % 9000) + 1000}-AX`;
  const sequenceId = `${(hash % 990) + 10}-AF`;

  const walletStatus = isLoading
    ? "Checking wallet"
    : isAuthorized
      ? "Wallet linked"
      : isWalletDetected
        ? "Permission required"
        : "Freighter not detected";

  return (
    <section className="min-h-full bg-bg-primary px-6 py-8 lg:px-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="rounded-2xl border border-border-default bg-card p-4 md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">
                Vault Identity
              </p>
              <p className="mt-1 text-sm text-text-primary">
                {shortAddress ?? "No connected wallet"}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs text-text-secondary">
                {walletStatus}
              </span>
              {!isAuthorized && (
                <button
                  onClick={() => void connectWallet()}
                  disabled={isLoading}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? "Connecting..." : "Connect Freighter"}
                </button>
              )}
            </div>
          </div>
        </div>

        <VaultHero
          escrowId={escrowId}
          custodyType={isAuthorized ? "Institutional Custody" : "Pending Wallet Authorization"}
          status={isAuthorized ? "Funds Locked" : "Awaiting Wallet Link"}
          isSecured={isAuthorized}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="md:col-span-2 lg:col-span-2">
            <ReleaseSequenceCard
              sequenceId={sequenceId}
              steps={[
                { label: "Agreement", date: "Oct 12, 2023", status: "completed" },
                {
                  label: "Audit Phase",
                  date: isAuthorized ? "In progress" : "Wallet pending",
                  status: "in-progress",
                },
                { label: "Final Release", date: "Est. Nov 04", status: "pending" },
              ]}
            />
          </div>

          <div>
            <VaultValueCard
              value={vaultValue}
              currency="USD"
              isInsured={isAuthorized}
              onReleaseFunds={() => undefined}
            />
          </div>

          <div className="md:col-span-2 lg:col-span-2">
            <ContractManifestCard
              contractId={`AMN-${(hash % 900) + 100}-VLT-09`}
              agreementDate="September 24, 2023"
              settlementType="Immediate / Fiat-Backed"
              originParty={{
                initials: "GB",
                name: "Global Biotech Inc.",
                color: "teal",
              }}
              recipientParty={{
                initials: "NS",
                name: "Nova Solutions Ltd.",
                color: "emerald",
              }}
              onExportPdf={() => undefined}
              onViewClauses={() => undefined}
            />
          </div>

          <div>
            <AuditLogCard
              entries={[
                {
                  type: "biometric",
                  title: "Biometric validation passed",
                  metadata: "2m ago - 192.168.1.44",
                },
                {
                  type: "multi-sig",
                  title: "Multi-sig request broadcast",
                  metadata: "1h ago - ID: 494022",
                },
                {
                  type: "ledger",
                  title: `Ledger sync ${address ? "confirmed" : "pending wallet"}`,
                  metadata: "Yesterday - Block 182,990",
                },
              ]}
              isLiveSync={isAuthorized}
            />
          </div>

          <div className="md:col-span-2 lg:col-span-3 rounded-2xl border border-border-default bg-card p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-gold">Partner network</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {PARTNERS.map((partner) => (
                <div
                  key={partner}
                  className="rounded-xl border border-border-default bg-bg-elevated px-3 py-4 text-center text-sm font-medium text-text-secondary"
                >
                  {partner}
                </div>
              ))}
            </div>
          </div>
        </div>

        <VaultFooter
          version={FOOTER_CONTENT.version}
          links={FOOTER_CONTENT.links}
          socialLinks={FOOTER_CONTENT.socialLinks}
        />
      </div>
    </section>
  );
}
