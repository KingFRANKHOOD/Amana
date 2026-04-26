import { ArrowRight, CircleDollarSign, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";

const workflows = [
  {
    title: "Create a trade",
    description: "Set parties, amount, and settlement terms before escrow starts.",
    href: "/trades/create",
    icon: CircleDollarSign,
  },
  {
    title: "Review assets",
    description: "Inspect vault state, manifests, and current settlement progress.",
    href: "/assets",
    icon: ShieldCheck,
  },
  {
    title: "Resolve disputes",
    description: "Complete outcomes with mediator review and evidence-backed rulings.",
    href: "/trades",
    icon: Scale,
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-bg-primary px-6 py-10 text-text-primary lg:px-10">
      <section className="mx-auto max-w-7xl">
        <h1 className="text-5xl font-semibold leading-tight md:text-display">Amana</h1>
        <p className="mt-4 max-w-2xl text-lg text-text-secondary">
          Agricultural escrow with verifiable settlement, evidence flow, and dispute resolution.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/trades/create"
            className="inline-flex items-center gap-2 rounded-md bg-gold px-5 py-3 font-semibold text-text-inverse hover:bg-gold-hover"
          >
            Start trade
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md border border-border-default px-5 py-3 font-semibold hover:bg-bg-card"
          >
            Open dashboard
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-10 grid max-w-7xl grid-cols-1 gap-5 md:grid-cols-3">
        {workflows.map((workflow) => {
          const Icon = workflow.icon;
          return (
            <Link
              key={workflow.href}
              href={workflow.href}
              className="rounded-lg border border-border-default bg-bg-card p-5 transition-colors hover:border-border-hover"
            >
              <Icon className="h-5 w-5 text-gold" />
              <h2 className="mt-4 text-lg font-semibold">{workflow.title}</h2>
              <p className="mt-2 text-sm text-text-secondary">{workflow.description}</p>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
