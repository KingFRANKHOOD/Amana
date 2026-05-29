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

/*
 * #444 — Typography hierarchy follows Figma token scale:
 *   h1  → text-4xl / md:text-display  (heading level 1 — display)
 *   h2  → text-2xl                    (heading level 2)
 *   p   → text-base / text-lg         (body)
 *   small metadata → text-sm with text-text-secondary / text-text-muted
 *
 * All sizes reference tokens in tailwind.config.ts — no ad-hoc values.
 */
export default function Home() {
  return (
    <main className="min-h-screen bg-bg-primary px-6 py-10 text-text-primary lg:px-10">
      {/* Hero — heading 1 (display) */}
      <section className="mx-auto max-w-7xl">
        <h1 className="text-4xl font-semibold leading-tight md:text-display">
          Amana
        </h1>

        {/* Body */}
        <p className="mt-4 max-w-2xl text-base text-text-secondary md:text-lg">
          Agricultural escrow with verifiable settlement, evidence flow, and
          dispute resolution.
        </p>

        {/* CTA */}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/trades/create"
            className="inline-flex items-center gap-2 rounded-md bg-gold px-5 py-3 text-base font-semibold text-text-inverse hover:bg-gold-hover"
          >
            Start trade
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md border border-border-default px-5 py-3 text-base font-semibold hover:bg-bg-card"
          >
            Open dashboard
          </Link>
        </div>
      </section>

      {/* Workflow cards — heading 2 + body + metadata */}
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
              {/* Heading 2 */}
              <h2 className="mt-4 text-2xl font-semibold">{workflow.title}</h2>
              {/* Body / metadata */}
              <p className="mt-2 text-sm text-text-secondary">
                {workflow.description}
              </p>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
