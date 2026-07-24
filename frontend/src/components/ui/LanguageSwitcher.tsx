"use client";

import { useLocaleStore } from "@/stores/localeStore";
import { LOCALE_LABELS, type Locale } from "@/i18n";

const LOCALES: Locale[] = ["en", "fr"];

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocaleStore();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Select language"
      className="rounded-lg border border-border-default bg-bg-input text-text-primary text-sm px-2 py-1.5 focus:outline-none focus:border-border-focus transition-colors cursor-pointer"
    >
      {LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
