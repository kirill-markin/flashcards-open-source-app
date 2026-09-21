export const supportedLocales = [
  "en",
  "ar",
  "zh-Hans",
  "de",
  "hi",
  "ja",
  "ru",
  "es-MX",
  "es-ES",
  "fr",
  "pt-BR",
  "it",
  "ko",
  "id",
  "tr",
  "nl",
  "pl",
  "vi",
  "th",
  "uk",
  "he",
  "sv",
  "da",
  "nb",
  "fi",
  "cs",
  "el",
  "ro",
  "hu",
  "fa",
  "ca",
  "bn",
  "gu",
  "kn",
  "ml",
  "mr",
  "pa",
  "ta",
  "te",
  "ur",
  "sw",
  "bg",
  "et",
  "hr",
  "is",
  "lt",
  "lv",
  "sk",
  "sl",
  "zu",
] as const;
export const defaultLocale = "en" as const;
export const defaultSpanishLocale = "es-ES" as const;
export const autoLocalePreference = "auto" as const;

export type Locale = (typeof supportedLocales)[number];
export type LocalePreference = Locale | typeof autoLocalePreference;
export type LocaleDirection = "ltr" | "rtl";

export type TranslationValues = Readonly<Record<string, number | string>>;

export type DateTimeValue = Date | number | string;

// `two` and `few` are filled only by languages whose CLDR rules need them; absent forms fall back to `other`.
export type PluralCountLabels = Readonly<{
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  other: string;
}>;
