"use client";

import { useMemo } from "react";
import { useLocaleStore } from "@/stores/localeStore";
import { getDictionary, t, type T } from "@/i18n";

export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const dict: T = useMemo(() => getDictionary(locale), [locale]);

  const translate = useMemo(() => {
    function tc(key: string, params?: Record<string, string | number>): string {
      return t(dict, key, params);
    }
    return tc;
  }, [dict]);

  return { t: translate, locale, dict };
}
