export const supportedLocales = ["en", "ar", "zh-Hans", "de", "hi", "ja", "ru", "es-MX", "es-ES"] as const;
export const defaultLocale = "en" as const;
export const defaultSpanishLocale = "es-ES" as const;
export const autoLocalePreference = "auto" as const;

export type Locale = (typeof supportedLocales)[number];
export type LocalePreference = Locale | typeof autoLocalePreference;
export type LocaleDirection = "ltr" | "rtl";

export type TranslationValues = Readonly<Record<string, number | string>>;

export type DateTimeValue = Date | number | string;

export type PluralCountLabels = Readonly<{
  zero?: string;
  one: string;
  other: string;
}>;
