import en from "./dictionaries/en";
import fr from "./dictionaries/fr";

export type Locale = "en" | "fr";

export type { TranslationKeys } from "./dictionaries/en";

const dictionaries = { en, fr } as const;

export function getDictionary(locale: Locale): Record<string, string> {
  return (dictionaries[locale] ?? dictionaries.en) as Record<string, string>;
}

export type T = Record<string, string>;

/**
 * Simple dot-path lookup for nested translation keys.
 * Supports up to 4 levels of nesting.
 */
export function t(
  dict: T,
  key: string,
  params?: Record<string, string | number>,
): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = dict;
  for (const part of parts) {
    if (value == null || typeof value !== "object") return key;
    value = value[part];
  }
  if (typeof value !== "string") return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_: string, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`,
  );
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Fran\u00e7ais",
};
