import {
  defaultLocale,
  defaultSpanishLocale,
  type Locale,
  type LocaleDirection,
  supportedLocales,
} from "./types";

const localeDirections: Readonly<Record<Locale, LocaleDirection>> = {
  en: "ltr",
  ar: "rtl",
  "zh-Hans": "ltr",
  de: "ltr",
  hi: "ltr",
  ja: "ltr",
  ru: "ltr",
  "es-MX": "ltr",
  "es-ES": "ltr",
};

const primaryLanguageLocaleFallbacks: Readonly<Record<string, Locale>> = {
  ar: "ar",
  de: "de",
  en: "en",
  hi: "hi",
  ja: "ja",
  ru: "ru",
};

const legacyLocalePreferenceMap: Readonly<Record<string, Locale>> = {
  en: "en",
  es: defaultSpanishLocale,
};

function hasOwnProperty<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): key is keyof typeof record {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isSupportedLocale(value: string): value is Locale {
  return supportedLocales.some((supportedLocale) => supportedLocale === value);
}

export function normalizeLanguageTag(languageTag: string): string | null {
  const normalizedTag = languageTag.replaceAll("_", "-").trim();

  if (normalizedTag === "") {
    return null;
  }

  try {
    const canonicalLanguageTag = Intl.getCanonicalLocales(normalizedTag)[0];
    return canonicalLanguageTag ?? null;
  } catch {
    return null;
  }
}

export function normalizeSupportedLocale(languageTag: string): Locale | null {
  const normalizedLanguageTag = normalizeLanguageTag(languageTag);
  if (normalizedLanguageTag === null) {
    return null;
  }

  return isSupportedLocale(normalizedLanguageTag) ? normalizedLanguageTag : null;
}

export function migrateLegacyLocalePreference(storedValue: string): Locale | null {
  return hasOwnProperty(legacyLocalePreferenceMap, storedValue) ? legacyLocalePreferenceMap[storedValue] : null;
}

function resolveSpanishLocale(region: string | null): Locale {
  if (region === "MX") {
    return "es-MX";
  }

  return defaultSpanishLocale;
}

function resolveChineseLocale(script: string | null, region: string | null): Locale | null {
  if (script === "Hans" || region === "CN" || region === "SG") {
    return "zh-Hans";
  }

  return null;
}

export function resolveSupportedLocale(languageTag: string): Locale | null {
  const exactLocale = normalizeSupportedLocale(languageTag);
  if (exactLocale !== null) {
    return exactLocale;
  }

  const normalizedLanguageTag = normalizeLanguageTag(languageTag);
  if (normalizedLanguageTag === null) {
    return null;
  }

  const locale = new Intl.Locale(normalizedLanguageTag);
  if (locale.language === "es") {
    return resolveSpanishLocale(locale.region ?? null);
  }

  if (locale.language === "zh") {
    return resolveChineseLocale(locale.script ?? null, locale.region ?? null);
  }

  return hasOwnProperty(primaryLanguageLocaleFallbacks, locale.language)
    ? primaryLanguageLocaleFallbacks[locale.language]
    : null;
}

export function getLocaleDirection(locale: Locale): LocaleDirection {
  return localeDirections[locale];
}

export function getDefaultLocale(): Locale {
  return defaultLocale;
}
