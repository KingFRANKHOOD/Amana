"use client";

import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { useLocaleStore } from "@/stores/localeStore";
import type { Locale } from "@/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationPrefs {
  tradeUpdates: boolean;
  disputeAlerts: boolean;
  vaultActivity: boolean;
  systemAnnouncements: boolean;
}

interface AppPrefs {
  network: "mainnet" | "testnet";
  currency: "USD" | "EUR" | "GBP" | "NGN";
  language: Locale;
  autoSignOut: "15" | "30" | "60" | "never";
}

interface ValidationErrors {
  [key: string]: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-card p-5 md:p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <hr className="border-border-default" />;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && (
          <p className="text-xs text-text-secondary mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
          checked ? "bg-gold" : "bg-bg-elevated"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-text-primary shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function SelectField({
  label,
  description,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
      <div className="flex-1">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && (
          <p className="text-xs text-text-secondary mt-0.5">{description}</p>
        )}
        {error && (
          <p className="text-xs text-status-danger mt-1 flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10a1 1 0 110 2 1 1 0 010-2zm0-7a1 1 0 011 1v4a1 1 0 11-2 0V5a1 1 0 011-1z" />
            </svg>
            {error}
          </p>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${label}-error` : undefined}
        className={`rounded-lg border ${error ? "border-status-danger" : "border-border-default"} bg-bg-input text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-border-focus transition-colors sm:w-44`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    address,
    isAuthenticated,
    isWalletConnected,
    isWalletDetected,
    isLoading,
    connectWallet,
    authenticate,
    logout,
  } = useAuth();

  const { t } = useTranslation();
  const { locale, setLocale } = useLocaleStore();

  const [notifications, setNotifications] = useState<NotificationPrefs>({
    tradeUpdates: true,
    disputeAlerts: true,
    vaultActivity: false,
    systemAnnouncements: true,
  });

  const [prefs, setPrefs] = useState<AppPrefs>({
    network: "testnet",
    currency: "USD",
    language: locale,
    autoSignOut: "30",
  });

  const [copied, setCopied] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>(
    {},
  );

  function setNotif<K extends keyof NotificationPrefs>(
    key: K,
    value: NotificationPrefs[K],
  ) {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  }

  function setPref<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setValidationErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function validatePreferences(): boolean {
    const errors: ValidationErrors = {};

    if (!prefs.network) {
      errors.network = "Network selection is required";
    }

    if (!prefs.currency) {
      errors.currency = "Currency selection is required";
    }

    if (!prefs.autoSignOut) {
      errors.autoSignOut = "Auto sign-out preference is required";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleCopyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSavePreferences() {
    if (!validatePreferences()) {
      return;
    }

    // Preferences are local-only for now; extend with API call as needed.
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  const walletStatus = isLoading
    ? t("settings.wallet.connecting")
    : isAuthenticated
      ? t("settings.wallet.authenticated")
      : isWalletConnected
        ? t("nav.connectWallet") + " \u2014 " + t("settings.wallet.signIn").toLowerCase()
        : isWalletDetected
          ? "Freighter \u2014 permission required"
          : "Freighter not detected";

  return (
    <section className="min-h-full bg-bg-primary px-6 py-8 lg:px-10">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t("settings.subtitle")}
          </p>
        </div>

        {/* ── Wallet & Identity ── */}
        <SectionCard
          title={t("settings.wallet.title")}
          description={t("settings.wallet.description")}
        >
          <div className="rounded-xl border border-border-default bg-bg-elevated px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-text-muted">
                {t("settings.wallet.address")}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isAuthenticated
                    ? "bg-emerald-muted text-emerald"
                    : isWalletConnected
                      ? "bg-gold-muted text-gold"
                      : "bg-bg-elevated text-text-muted border border-border-default"
                }`}
              >
                {isAuthenticated
                  ? t("settings.wallet.authenticated")
                  : isWalletConnected
                    ? t("settings.wallet.connected")
                    : t("settings.wallet.disconnected")}
              </span>
            </div>

            {address ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-text-primary font-mono break-all">
                  {address}
                </code>
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  title="Copy address"
                  className="shrink-0 p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                >
                  {copied ? (
                    <svg
                      className="w-4 h-4 text-emerald"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M2 8l4 4 8-8" />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <rect x="5" y="5" width="9" height="9" rx="1" />
                      <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" />
                    </svg>
                  )}
                </button>
              </div>
            ) : (
              <p className="text-sm text-text-muted italic">{walletStatus}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {!isWalletConnected && (
              <button
                type="button"
                onClick={connectWallet}
                disabled={isLoading}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse hover:bg-gold-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? t("settings.wallet.connecting") : t("settings.wallet.connectFreighter")}
              </button>
            )}
            {isWalletConnected && !isAuthenticated && (
              <button
                type="button"
                onClick={authenticate}
                disabled={isLoading}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse hover:bg-gold-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? t("settings.wallet.signing") : t("settings.wallet.signIn")}
              </button>
            )}
            {isAuthenticated && (
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-status-danger/40 text-status-danger px-4 py-2 text-sm font-semibold hover:bg-status-danger/10 transition-colors"
              >
                {t("settings.wallet.signOut")}
              </button>
            )}
          </div>
        </SectionCard>

        {/* ── Notifications ── */}
        <SectionCard
          title={t("settings.notifications.title")}
          description={t("settings.notifications.description")}
        >
          <div className="space-y-4">
            <Toggle
              label={t("settings.notifications.tradeUpdates")}
              description={t("settings.notifications.tradeUpdatesDesc")}
              checked={notifications.tradeUpdates}
              onChange={(v) => setNotif("tradeUpdates", v)}
            />
            <Divider />
            <Toggle
              label={t("settings.notifications.disputeAlerts")}
              description={t("settings.notifications.disputeAlertsDesc")}
              checked={notifications.disputeAlerts}
              onChange={(v) => setNotif("disputeAlerts", v)}
            />
            <Divider />
            <Toggle
              label={t("settings.notifications.vaultActivity")}
              description={t("settings.notifications.vaultActivityDesc")}
              checked={notifications.vaultActivity}
              onChange={(v) => setNotif("vaultActivity", v)}
            />
            <Divider />
            <Toggle
              label={t("settings.notifications.systemAnnouncements")}
              description={t("settings.notifications.systemAnnouncementsDesc")}
              checked={notifications.systemAnnouncements}
              onChange={(v) => setNotif("systemAnnouncements", v)}
            />
          </div>
        </SectionCard>

        {/* ── Application Preferences ── */}
        <SectionCard
          title={t("settings.preferences.title")}
          description={t("settings.preferences.description")}
        >
          <div className="space-y-5">
            <SelectField
              label={t("settings.preferences.language")}
              description={t("settings.preferences.languageDesc")}
              value={prefs.language}
              onChange={(v) => {
                const newLocale = v as Locale;
                setPref("language", newLocale);
                setLocale(newLocale);
              }}
              options={[
                { value: "en", label: t("settings.preferences.languageEn") },
                { value: "fr", label: t("settings.preferences.languageFr") },
              ]}
            />
            <Divider />
            <SelectField
              label={t("settings.preferences.network")}
              description={t("settings.preferences.networkDesc")}
              value={prefs.network}
              onChange={(v) => setPref("network", v as AppPrefs["network"])}
              error={validationErrors.network}
              options={[
                { value: "mainnet", label: t("settings.preferences.networkMainnet") },
                { value: "testnet", label: t("settings.preferences.networkTestnet") },
              ]}
            />
            <Divider />
            <SelectField
              label={t("settings.preferences.currency")}
              description={t("settings.preferences.currencyDesc")}
              value={prefs.currency}
              onChange={(v) => setPref("currency", v as AppPrefs["currency"])}
              options={[
                { value: "USD", label: t("settings.preferences.currencyUSD") },
                { value: "EUR", label: t("settings.preferences.currencyEUR") },
                { value: "GBP", label: t("settings.preferences.currencyGBP") },
                { value: "NGN", label: t("settings.preferences.currencyNGN") },
              ]}
            />
            <Divider />
            <SelectField
              label={t("settings.preferences.autoSignOut")}
              description={t("settings.preferences.autoSignOutDesc")}
              value={prefs.autoSignOut}
              onChange={(v) =>
                setPref("autoSignOut", v as AppPrefs["autoSignOut"])
              }
              options={[
                { value: "15", label: t("settings.preferences.autoSignOut15") },
                { value: "30", label: t("settings.preferences.autoSignOut30") },
                { value: "60", label: t("settings.preferences.autoSignOut60") },
                { value: "never", label: t("settings.preferences.autoSignOutNever") },
              ]}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSavePreferences}
              className="rounded-lg bg-gold px-5 py-2 text-sm font-semibold text-text-inverse hover:bg-gold-hover transition-colors"
            >
              {t("settings.preferences.save")}
            </button>
            {saveSuccess && (
              <span className="text-sm text-emerald flex items-center gap-1.5">
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M2 8l4 4 8-8" />
                </svg>
                {t("settings.preferences.saved")}
              </span>
            )}
          </div>
        </SectionCard>

        {/* ── Security ── */}
        <SectionCard
          title={t("settings.security.title")}
          description={t("settings.security.description")}
        >
          <ul className="space-y-3">
            {[
              {
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M8 1l5 2.2V7c0 3.3-2.3 5.8-5 6.8C3.3 12.8 1 10.3 1 7V3.2L8 1z" />
                  </svg>
                ),
                label: t("settings.security.nonCustodial"),
                detail: t("settings.security.nonCustodialDesc"),
              },
              {
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <rect x="3" y="7" width="10" height="7" rx="1" />
                    <path d="M5 7V5a3 3 0 016 0v2" />
                  </svg>
                ),
                label: t("settings.security.sessionToken"),
                detail: isAuthenticated
                  ? t("settings.security.sessionTokenActive")
                  : t("settings.security.sessionTokenInactive"),
              },
              {
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 5v3l2 2" />
                  </svg>
                ),
                label: t("settings.security.challengeResponse"),
                detail: t("settings.security.challengeResponseDesc"),
              },
            ].map((item) => (
              <li
                key={item.label}
                className="flex items-start gap-3 rounded-xl border border-border-default bg-bg-elevated px-4 py-3"
              >
                <span className="mt-0.5 shrink-0 text-gold">{item.icon}</span>
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {item.label}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* ── About ── */}
        <SectionCard title={t("settings.about.title")}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              { label: t("settings.about.platform"), value: "Amana" },
              { label: t("settings.about.version"), value: "V4.8.2" },
              {
                label: t("settings.about.network"),
                value:
                  prefs.network === "mainnet"
                    ? t("settings.about.networkMainnet")
                    : t("settings.about.networkTestnet"),
              },
              { label: t("settings.about.smartContracts"), value: "Soroban" },
              { label: t("settings.about.storage"), value: "IPFS" },
              { label: t("settings.about.wallet"), value: "Freighter" },
            ].map((row) => (
              <div key={row.label}>
                <dt className="text-text-muted">{row.label}</dt>
                <dd className="text-text-primary font-medium mt-0.5">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
    </section>
  );
}
