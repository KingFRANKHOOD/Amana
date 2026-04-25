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
    <div className="min-h-screen bg-gradient-hero text-text-primary flex flex-col">
      {/* Navigation Bar */}
      <nav className="border-b border-border-default px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold/30 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-gold"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-gold tracking-tight">
            Amana
          </span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/trades"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Trades
          </Link>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="max-w-3xl text-center space-y-12">
          {/* Hero Section */}
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-xl bg-gold-muted border border-gold/30 flex items-center justify-center shadow-glow-gold">
                <svg
                  className="w-10 h-10 text-gold"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
            </div>

            <div className="space-y-3">
              <h1 className="text-5xl md:text-6xl font-bold text-text-primary tracking-tight">
                Amana
              </h1>
              <p className="text-xl md:text-2xl text-gold font-semibold">
                Secure Agricultural Escrow on Blockchain
              </p>
            </div>

            <p className="text-lg text-text-secondary leading-relaxed max-w-2xl mx-auto">
              Trade with confidence. Amana enables secure peer-to-peer
              agricultural commodity settlement with blockchain-backed escrow,
              real-time evidence submission, and mediator-led dispute
              resolution.
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="bg-bg-card border border-border-default rounded-xl p-6 hover:border-border-hover transition-colors">
              <div className="w-12 h-12 rounded-lg bg-gold-muted text-gold flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-text-primary mb-2 text-lg">
                Real-Time Settlement
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Execute and settle trades instantly with blockchain verification
                and transparent transaction tracking.
              </p>
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
            {/* Feature 2 */}
            <div className="bg-bg-card border border-border-default rounded-xl p-6 hover:border-border-hover transition-colors">
              <div className="w-12 h-12 rounded-lg bg-emerald-muted text-emerald flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-text-primary mb-2 text-lg">
                Verified Evidence
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Submit and verify evidence directly on-chain for complete
                transparency and immutable record-keeping.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-bg-card border border-border-default rounded-xl p-6 hover:border-border-hover transition-colors">
              <div className="w-12 h-12 rounded-lg bg-teal/15 text-teal flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-text-primary mb-2 text-lg">
                Fair Dispute Resolution
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Trusted mediators ensure fair resolution of any trade disputes
                with transparent evidence review.
              </p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
            <Link
              href="/dashboard"
              className="px-8 py-4 bg-gradient-gold-cta text-text-inverse font-semibold rounded-lg hover:shadow-glow-gold transition-all duration-200 text-center"
            >
              Go to Dashboard
            </Link>
            <Link
              href="/trades"
              className="px-8 py-4 border border-border-default text-text-primary font-semibold rounded-lg hover:bg-bg-card hover:border-border-hover transition-colors text-center"
            >
              View Trades
            </Link>
          </div>

          {/* Trust Indicators */}
          <div className="pt-8 border-t border-border-default">
            <p className="text-sm text-text-muted mb-6">
              Built on proven technology
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8 text-text-secondary text-sm">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-emerald"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Stellar Blockchain</span>
              </div>
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-emerald"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Soroban Smart Contracts</span>
              </div>
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-emerald"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>IPFS Storage</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border-default px-6 py-6 text-center text-sm text-text-muted">
        <p>© 2026 Amana. Secure agricultural escrow on blockchain.</p>
      </footer>
    </div>
  );
}
