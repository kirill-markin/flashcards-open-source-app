export const supportedLocales = [
  "en",
  "en-AU",
  "en-CA",
  "en-GB",
  "ar",
  "zh-Hans",
  "zh-Hant",
  "de",
  "hi",
  "ja",
  "ru",
  "es-MX",
  "es-ES",
  "fr",
  "fr-CA",
  "pt-BR",
  "pt-PT",
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
  "ms",
  "or",
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

// `two` and `few` are filled only by languages whose CLDR rules need them; absent forms and `many` render
// `other`, so `other` must also read correctly for those counts.
export type PluralCountLabels = Readonly<{
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  other: string;
}>;

// A whole phrase per CLDR category, each placing `{{count}}` itself, so a form such as Hebrew `two`
// can name the count without the number.
export type PluralMessages = Readonly<Record<Intl.LDMLPluralRule, string>>;
