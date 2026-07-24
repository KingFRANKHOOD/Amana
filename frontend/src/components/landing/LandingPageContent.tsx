"use client";

import {
  ArrowRight,
  CircleDollarSign,
  Scale,
  ShieldCheck,
  Truck,
  Lock,
  CheckCircle2,
  Star,
} from "lucide-react";
import Link from "next/link";
import { LandingCtaButtons } from "@/components/landing/LandingCtaButtons";
import { useTranslation } from "@/hooks/useTranslation";

export function LandingPageContent() {
  const { t } = useTranslation();

  const stats = [
    { label: t("landing.stats.tradesSettled"), value: "2,400+" },
    { label: t("landing.stats.totalEscrowValue"), value: "$1.2M" },
    { label: t("landing.stats.disputeResolutionRate"), value: "98%" },
    { label: t("landing.stats.network"), value: "Stellar" },
  ];

  const steps = [
    {
      step: "01",
      title: t("landing.steps.createTrade.title"),
      description: t("landing.steps.createTrade.description"),
      icon: CircleDollarSign,
    },
    {
      step: "02",
      title: t("landing.steps.trackDelivery.title"),
      description: t("landing.steps.trackDelivery.description"),
      icon: Truck,
    },
    {
      step: "04",
      title: t("landing.steps.verifyComplete.title"),
      description: t("landing.steps.verifyComplete.description"),
      icon: CheckCircle2,
    },
  ];

  const features = [
    {
      icon: Lock,
      title: t("landing.features.nonCustodial.title"),
      description: t("landing.features.nonCustodial.description"),
    },
    {
      icon: ShieldCheck,
      title: t("landing.features.evidence.title"),
      description: t("landing.features.evidence.description"),
    },
    {
      icon: Star,
      title: t("landing.features.reputation.title"),
      description: t("landing.features.reputation.description"),
    },
    {
      icon: Scale,
      title: t("landing.features.mediation.title"),
      description: t("landing.features.mediation.description"),
    },
  ];

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-hero px-6 py-20 md:py-32 lg:px-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[480px] w-[480px] rounded-full bg-gold opacity-[0.04] blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-muted px-4 py-1.5 text-sm font-medium text-gold">
            {t("landing.eyebrow")}
          </span>

          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-text-primary md:text-5xl">
            {t("landing.headline")}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
            {t("landing.subheadline")}
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/trades/create"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-gold-cta px-6 py-3 text-base font-semibold text-text-inverse shadow-glow-gold transition-shadow hover:shadow-glow-gold/60 focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
            >
              {t("landing.startTrade")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg border border-border-default px-6 py-3 text-base font-semibold text-text-primary transition-colors hover:border-border-hover hover:bg-bg-card focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
            >
              {t("landing.openDashboard")}
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
            {t("landing.howItWorks")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-base text-text-secondary">
            {t("landing.howItWorksSubtitle")}
          </p>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {steps.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="relative rounded-xl border border-border-default bg-bg-card p-6 shadow-card"
                >
                  <span className="text-xs font-bold tracking-widest text-text-muted">
                    {item.step}
                  </span>
                  <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold-muted">
                    <Icon className="h-5 w-5 text-gold" />
                  </div>
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
            {t("landing.whyAmana")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-base text-text-secondary">
            {t("landing.whyAmanaSubtitle")}
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
            {t("landing.cta.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-text-secondary">
            {t("landing.cta.subtitle")}
          </p>
          <LandingCtaButtons />
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border-default px-6 py-8 lg:px-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-sm text-text-muted sm:flex-row">
          <span>&copy; {new Date().getFullYear()} Amana. {t("landing.footer.copyright")}</span>
          <nav aria-label="Footer navigation" className="flex gap-6">
            <Link href="/trades" className="hover:text-text-secondary transition-colors">
              {t("landing.footer.trades")}
            </Link>
            <Link href="/vault" className="hover:text-text-secondary transition-colors">
              {t("landing.footer.vault")}
            </Link>
            <Link href="/dashboard" className="hover:text-text-secondary transition-colors">
              {t("landing.footer.dashboard")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
