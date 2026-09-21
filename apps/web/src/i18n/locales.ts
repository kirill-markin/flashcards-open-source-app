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
  fr: "ltr",
  "pt-BR": "ltr",
  it: "ltr",
  ko: "ltr",
  id: "ltr",
  tr: "ltr",
  nl: "ltr",
  pl: "ltr",
  vi: "ltr",
  th: "ltr",
  uk: "ltr",
  he: "rtl",
  sv: "ltr",
  da: "ltr",
  nb: "ltr",
  fi: "ltr",
  cs: "ltr",
  el: "ltr",
  ro: "ltr",
  hu: "ltr",
  fa: "rtl",
  ca: "ltr",
  bn: "ltr",
  gu: "ltr",
  kn: "ltr",
  ml: "ltr",
  mr: "ltr",
  pa: "ltr",
  ta: "ltr",
  te: "ltr",
  ur: "rtl",
  sw: "ltr",
  bg: "ltr",
  et: "ltr",
  hr: "ltr",
  is: "ltr",
  lt: "ltr",
  lv: "ltr",
  sk: "ltr",
  sl: "ltr",
  zu: "ltr",
};

const primaryLanguageLocaleFallbacks: Readonly<Record<string, Locale>> = {
  ar: "ar",
  bg: "bg",
  bn: "bn",
  ca: "ca",
  cs: "cs",
  da: "da",
  de: "de",
  el: "el",
  en: "en",
  et: "et",
  fa: "fa",
  fi: "fi",
  fr: "fr",
  gu: "gu",
  he: "he",
  hi: "hi",
  hr: "hr",
  hu: "hu",
  id: "id",
  is: "is",
  it: "it",
  ja: "ja",
  kn: "kn",
  ko: "ko",
  lt: "lt",
  lv: "lv",
  ml: "ml",
  mr: "mr",
  nb: "nb",
  nl: "nl",
  // The Norwegian macrolanguage tag resolves to Bokmål, the written standard the catalog uses.
  no: "nb",
  pa: "pa",
  pl: "pl",
  pt: "pt-BR",
  ro: "ro",
  ru: "ru",
  sk: "sk",
  sl: "sl",
  sv: "sv",
  sw: "sw",
  ta: "ta",
  te: "te",
  th: "th",
  tr: "tr",
  uk: "uk",
  ur: "ur",
  vi: "vi",
  zu: "zu",
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
