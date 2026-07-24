"use client";

import { useEffect } from "react";
import { useLocaleStore } from "@/stores/localeStore";

/**
 * Syncs the document's `lang` attribute with the current locale
 * from the Zustand store. Must be rendered inside a client component.
 */
export function LocaleSync() {
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
