import {
  ArrowRight,
  CircleDollarSign,
  FileCheck2,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

const metrics = [
  { label: "Escrow status", value: "Active", tone: "text-emerald" },
  { label: "Settlement rail", value: "Stellar", tone: "text-status-info" },
  { label: "Evidence store", value: "IPFS", tone: "text-gold" },
];

const workflows = [
  {
    title: "Create a trade",
    description: "Define parties, escrow amount, and loss-sharing terms before funds move.",
    href: "/trades/create",
    icon: CircleDollarSign,
  },
  {
    title: "Track vault activity",
    description: "Review locked funds, release sequence, manifest records, and audit events.",
    href: "/vault",
    icon: ShieldCheck,
  },
  {
    title: "Resolve disputes",
    description: "Use signed evidence and mediator rulings when delivery does not match terms.",
    href: "/trades",
    icon: Scale,
  },
];

const proofSteps = [
  "Buyer and seller agree escrow terms",
  "Funds lock before fulfillment starts",
  "Manifest and evidence stay reviewable",
  "Release or dispute resolution closes the trade",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-bg-primary text-text-primary">
      <section className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-10 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-center lg:px-10">
        <div className="flex flex-col justify-center">
          <div className="mb-8 flex items-center gap-3 text-sm text-text-secondary">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald" />
            Live escrow workspace
          </div>

          <h1 className="max-w-4xl text-5xl font-semibold leading-tight text-text-primary md:text-display">
            Amana
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary">
            Agricultural escrow for buyers, sellers, and mediators who need
            settlement, evidence, and dispute outcomes in one verifiable workflow.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/trades/create"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-gold px-5 py-3 font-semibold text-text-inverse transition-colors hover:bg-gold-hover"
            >
              Start trade
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/assets"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border-default px-5 py-3 font-semibold text-text-primary transition-colors hover:border-border-hover hover:bg-bg-card"
            >
              Open workspace
            </Link>
          </div>

          <div className="mt-10 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="border-l border-border-default pl-4">
                <p className="text-sm text-text-muted">{metric.label}</p>
                <p className={`mt-1 text-xl font-semibold ${metric.tone}`}>
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border-default bg-bg-card p-5 shadow-card">
          <div className="flex items-center justify-between border-b border-border-default pb-4">
            <div>
              <p className="text-sm text-text-muted">Current settlement</p>
              <p className="mt-1 text-2xl font-semibold">Trade AM-2049</p>
            </div>
            <span className="rounded-md bg-emerald-muted px-3 py-1 text-sm font-medium text-emerald">
              Funded
            </span>
          </div>

          <div className="mt-5 space-y-4">
            {proofSteps.map((step, index) => (
              <div key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-default bg-bg-primary text-sm text-gold">
                    {index + 1}
                  </span>
                  {index < proofSteps.length - 1 ? (
                    <span className="h-8 w-px bg-border-default" />
                  ) : null}
                </div>
                <p className="pt-1 text-sm leading-6 text-text-secondary">{step}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-md bg-bg-primary p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <FileCheck2 className="h-4 w-4 text-status-info" aria-hidden="true" />
              Evidence packet
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-text-muted">Manifest</p>
                <p className="mt-1 text-text-primary">Submitted</p>
              </div>
              <div>
                <p className="text-text-muted">Mediator</p>
                <p className="mt-1 text-text-primary">Available</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border-default px-6 py-10 lg:px-10">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 md:grid-cols-3">
          {workflows.map((workflow) => {
            const Icon = workflow.icon;
            return (
              <Link
                key={workflow.href}
                href={workflow.href}
                className="group rounded-lg border border-border-default bg-bg-card p-5 transition-colors hover:border-border-hover"
              >
                <Icon className="h-5 w-5 text-gold" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-text-primary">
                  {workflow.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  {workflow.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gold">
                  Continue
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
