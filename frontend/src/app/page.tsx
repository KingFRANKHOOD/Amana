import {
  ArrowRight,
  CircleDollarSign,
  Scale,
  ShieldCheck,
  Truck,
  Lock,
  FileCheck,
  Star,
} from "lucide-react";
import Link from "next/link";
import { LandingCtaButtons } from "@/components/landing/LandingCtaButtons";

// ─── Data ────────────────────────────────────────────────────────────────────

const stats = [
  { label: "Trades settled", value: "2,400+" },
  { label: "Total escrow value", value: "$1.2M" },
  { label: "Dispute resolution rate", value: "98%" },
  { label: "Network", value: "Stellar" },
];

const steps = [
  {
    step: "01",
    title: "Create a trade",
    description:
      "Define counterparties, commodity, amount, and settlement terms. Funds are locked in escrow on the Stellar network before any goods move.",
    icon: CircleDollarSign,
  },
  {
    step: "02",
    title: "Track delivery",
    description:
      "Driver manifests, GPS checkpoints, and video evidence are attached on-chain as the shipment moves from farm to buyer.",
    icon: Truck,
  },
  {
    step: "03",
    title: "Verify & settle",
    description:
      "On confirmed delivery, escrow releases automatically. If a dispute arises, a mediator reviews evidence and issues a binding ruling.",
    icon: FileCheck,
  },
];

const features = [
  {
    icon: Lock,
    title: "Non-custodial escrow",
    description:
      "Funds are held in a Soroban smart contract — no intermediary can move them without both parties' agreement or a mediator ruling.",
  },
  {
    icon: ShieldCheck,
    title: "Evidence-backed disputes",
    description:
      "Every dispute is anchored to verifiable on-chain evidence: manifests, video proof, and signed delivery confirmations.",
  },
  {
    icon: Star,
    title: "Reputation scoring",
    description:
      "Each completed trade builds a trust score for buyers, sellers, and drivers — making future trades faster and lower-risk.",
  },
  {
    icon: Scale,
    title: "Impartial mediation",
    description:
      "Certified mediators review evidence and issue rulings with full audit trails, ensuring fair outcomes for all parties.",
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

/*
 * Typography hierarchy (Figma token scale):
 *   h1  → text-4xl / md:text-5xl   (hero heading)
 *   h2  → text-2xl / md:text-3xl   (section heading)
 *   h3  → text-xl                  (card heading)
 *   p   → text-base / text-lg      (body)
 *   small metadata → text-sm with text-text-secondary / text-text-muted
 */
export default function Home() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-hero px-6 py-20 md:py-32 lg:px-10">
        {/* Subtle radial glow behind the headline */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[480px] w-[480px] rounded-full bg-gold opacity-[0.04] blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          {/* Eyebrow */}
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-muted px-4 py-1.5 text-sm font-medium text-gold">
            Built on Stellar · Soroban smart contracts
          </span>

          {/* Headline */}
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-text-primary md:text-5xl">
            Agricultural trade you can{" "}
            <span className="bg-gradient-gold-cta bg-clip-text text-transparent">
              trust
            </span>
          </h1>

          {/* Sub-headline */}
          <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
            Amana is a blockchain-powered escrow platform for agricultural
            commodities. Lock funds, track delivery, resolve disputes — all
            with verifiable on-chain evidence.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/trades/create"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-gold-cta px-6 py-3 text-base font-semibold text-text-inverse shadow-glow-gold transition-shadow hover:shadow-glow-gold/60 focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
            >
              Start a trade
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg border border-border-default px-6 py-3 text-base font-semibold text-text-primary transition-colors hover:border-border-hover hover:bg-bg-card focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
            >
              Open dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section
        aria-label="Platform statistics"
        className="border-y border-border-default bg-bg-card px-6 py-8 lg:px-10"
      >
        <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="text-sm text-text-muted">{stat.label}</dt>
              <dd className="mt-1 text-2xl font-bold text-text-primary">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold md:text-3xl">
            How it works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-base text-text-secondary">
            Three steps from agreement to settlement — fully on-chain, fully
            auditable.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {steps.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="relative rounded-xl border border-border-default bg-bg-card p-6 shadow-card"
                >
                  {/* Step number */}
                  <span className="text-xs font-bold tracking-widest text-text-muted">
                    {item.step}
                  </span>
                  {/* Icon */}
                  <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold-muted">
                    <Icon className="h-5 w-5 text-gold" />
                  </div>
                  {/* Content */}
                  <h3 className="mt-4 text-xl font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="bg-bg-card px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold md:text-3xl">
            Why Amana
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-base text-text-secondary">
            Purpose-built for agricultural supply chains where trust, evidence,
            and fair resolution matter most.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="flex gap-4 rounded-xl border border-border-default bg-bg-elevated p-6 transition-colors hover:border-border-hover"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gold-muted">
                    <Icon className="h-5 w-5 text-gold" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                      {feature.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-2xl rounded-2xl border border-gold/20 bg-gradient-card-glow p-10 text-center shadow-glow-gold">
          <h2 className="text-2xl font-bold md:text-3xl">
            Ready to settle your first trade?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-text-secondary">
            Connect your Freighter wallet and create a trade in under two
            minutes.
          </p>
          <LandingCtaButtons />
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border-default px-6 py-8 lg:px-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-sm text-text-muted sm:flex-row">
          <span>© {new Date().getFullYear()} Amana. Agricultural escrow on Stellar.</span>
          <nav aria-label="Footer navigation" className="flex gap-6">
            <Link href="/trades" className="hover:text-text-secondary transition-colors">
              Trades
            </Link>
            <Link href="/vault" className="hover:text-text-secondary transition-colors">
              Vault
            </Link>
            <Link href="/dashboard" className="hover:text-text-secondary transition-colors">
              Dashboard
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
