export const SUPPORTED_LOCALES = ["en", "nl", "de", "fr", "es", "af", "xh", "zu"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "nl";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  nl: "Nederlands",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  af: "Afrikaans",
  xh: "isiXhosa",
  zu: "isiZulu",
};
