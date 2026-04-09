export const supportedLocales = ["en", "es"] as const;
export const autoLocalePreference = "auto" as const;

export type Locale = (typeof supportedLocales)[number];
export type LocalePreference = Locale | typeof autoLocalePreference;

export type TranslationValues = Readonly<Record<string, number | string>>;

export type DateTimeValue = Date | number | string;

export type PluralCountLabels = Readonly<{
  zero?: string;
  one: string;
  other: string;
}>;
