const SUPPORTED_LOGIN_PAGE_LOCALES = [
  "en", "ar", "zh-Hans", "fr", "de", "hi", "ja", "pt-BR", "ru", "es-MX", "es-ES",
  "bg", "bn", "ca", "cs", "da", "el", "et", "fa", "fi", "gu", "he", "hr", "hu",
  "id", "is", "it", "kn", "ko", "lt", "lv", "ml", "mr", "nb", "nl", "pa", "pl",
  "ro", "sk", "sl", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "vi", "zu",
] as const;
const DEFAULT_LOGIN_PAGE_LOCALE = "en" as const;
const DEFAULT_SPANISH_LOGIN_PAGE_LOCALE = "es-ES" as const;

export type LoginPageLocale = (typeof SUPPORTED_LOGIN_PAGE_LOCALES)[number];
export type LoginPageDirection = "ltr" | "rtl";

type AcceptLanguageEntry = Readonly<{
  languageTag: string;
  order: number;
  weight: number;
}>;

const LOGIN_PAGE_LOCALE_DIRECTIONS: Readonly<Record<LoginPageLocale, LoginPageDirection>> = {
  bg: "ltr",
  bn: "ltr",
  ca: "ltr",
  cs: "ltr",
  da: "ltr",
  el: "ltr",
  et: "ltr",
  fa: "rtl",
  fi: "ltr",
  gu: "ltr",
  he: "rtl",
  hr: "ltr",
  hu: "ltr",
  id: "ltr",
  is: "ltr",
  it: "ltr",
  kn: "ltr",
  ko: "ltr",
  lt: "ltr",
  lv: "ltr",
  ml: "ltr",
  mr: "ltr",
  nb: "ltr",
  nl: "ltr",
  pa: "ltr",
  pl: "ltr",
  ro: "ltr",
  sk: "ltr",
  sl: "ltr",
  sv: "ltr",
  sw: "ltr",
  ta: "ltr",
  te: "ltr",
  th: "ltr",
  tr: "ltr",
  uk: "ltr",
  ur: "rtl",
  vi: "ltr",
  zu: "ltr",
  en: "ltr",
  ar: "rtl",
  "zh-Hans": "ltr",
  fr: "ltr",
  de: "ltr",
  hi: "ltr",
  ja: "ltr",
  "pt-BR": "ltr",
  ru: "ltr",
  "es-MX": "ltr",
  "es-ES": "ltr",
};

const PRIMARY_LANGUAGE_LOGIN_PAGE_FALLBACKS: Readonly<Record<string, LoginPageLocale>> = {
  bg: "bg",
  bn: "bn",
  ca: "ca",
  cs: "cs",
  da: "da",
  el: "el",
  et: "et",
  fa: "fa",
  fi: "fi",
  gu: "gu",
  he: "he",
  hr: "hr",
  hu: "hu",
  id: "id",
  is: "is",
  it: "it",
  kn: "kn",
  ko: "ko",
  lt: "lt",
  lv: "lv",
  ml: "ml",
  mr: "mr",
  nb: "nb",
  nl: "nl",
  pa: "pa",
  pl: "pl",
  ro: "ro",
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
  no: "nb",
  ar: "ar",
  de: "de",
  en: "en",
  fr: "fr",
  hi: "hi",
  ja: "ja",
  pt: "pt-BR",
  ru: "ru",
};

const LEGACY_LOGIN_PAGE_LOCALE_MAP: Readonly<Record<string, LoginPageLocale>> = {
  en: "en",
  es: DEFAULT_SPANISH_LOGIN_PAGE_LOCALE,
};

function hasOwnProperty<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): key is keyof typeof record {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isSupportedLoginPageLocale(value: string): value is LoginPageLocale {
  return SUPPORTED_LOGIN_PAGE_LOCALES.some((supportedLocale) => supportedLocale === value);
}

function normalizeLanguageTag(languageTag: string): string | null {
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

export function normalizeSupportedLoginPageLocale(languageTag: string): LoginPageLocale | null {
  const normalizedLanguageTag = normalizeLanguageTag(languageTag);
  if (normalizedLanguageTag === null) {
    return null;
  }

  return isSupportedLoginPageLocale(normalizedLanguageTag) ? normalizedLanguageTag : null;
}

function resolveSpanishLocale(region: string | null): LoginPageLocale {
  if (region === "MX") {
    return "es-MX";
  }

  return DEFAULT_SPANISH_LOGIN_PAGE_LOCALE;
}

function resolveChineseLocale(script: string | null, region: string | null): LoginPageLocale | null {
  if (script === "Hans" || region === "CN" || region === "SG") {
    return "zh-Hans";
  }

  return null;
}

function resolveSupportedLoginPageLocale(languageTag: string): LoginPageLocale | null {
  const exactLocale = normalizeSupportedLoginPageLocale(languageTag);
  if (exactLocale !== null) {
    return exactLocale;
  }

  const normalizedLanguageTag = normalizeLanguageTag(languageTag);
  if (normalizedLanguageTag === null) {
    return null;
  }

  if (hasOwnProperty(LEGACY_LOGIN_PAGE_LOCALE_MAP, normalizedLanguageTag)) {
    return LEGACY_LOGIN_PAGE_LOCALE_MAP[normalizedLanguageTag];
  }

  const locale = new Intl.Locale(normalizedLanguageTag);
  if (locale.language === "es") {
    return resolveSpanishLocale(locale.region ?? null);
  }

  if (locale.language === "zh") {
    return resolveChineseLocale(locale.script ?? null, locale.region ?? null);
  }

  return hasOwnProperty(PRIMARY_LANGUAGE_LOGIN_PAGE_FALLBACKS, locale.language)
    ? PRIMARY_LANGUAGE_LOGIN_PAGE_FALLBACKS[locale.language]
    : null;
}

function parseAcceptLanguageWeight(entryPart: string): number | null {
  const weight = Number.parseFloat(entryPart);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    return null;
  }

  return weight;
}

function parseAcceptLanguageEntry(entry: string, order: number): AcceptLanguageEntry | null {
  const entryParts = entry.split(";").map((part) => part.trim()).filter((part) => part !== "");
  const languageTag = entryParts[0] ?? "";
  if (languageTag === "") {
    return null;
  }

  const qualityPart = entryParts.find((part) => part.startsWith("q="));
  const qualityValue = qualityPart?.slice("q=".length);
  const weight = qualityValue === undefined ? 1 : parseAcceptLanguageWeight(qualityValue);
  if (weight === null) {
    return null;
  }

  return {
    languageTag,
    order,
    weight,
  };
}

function parseAcceptLanguageHeader(acceptLanguageHeader: string | null | undefined): ReadonlyArray<string> {
  if (typeof acceptLanguageHeader !== "string" || acceptLanguageHeader.trim() === "") {
    return [];
  }

  return acceptLanguageHeader
    .split(",")
    .map((entry, index) => parseAcceptLanguageEntry(entry, index))
    .filter((entry): entry is AcceptLanguageEntry => entry !== null)
    .sort((left, right) => {
      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }

      return left.order - right.order;
    })
    .map((entry) => entry.languageTag);
}

export function getLoginPageLocaleDirection(locale: LoginPageLocale): LoginPageDirection {
  return LOGIN_PAGE_LOCALE_DIRECTIONS[locale];
}

export function sanitizeLoginPageLocaleHint(localeHint: string | null | undefined): LoginPageLocale | null {
  if (typeof localeHint !== "string") {
    return null;
  }

  return resolveSupportedLoginPageLocale(localeHint);
}

export function resolveLoginPageLocale(
  localeHint: string | null | undefined,
  acceptLanguageHeader: string | null | undefined,
): LoginPageLocale {
  const resolvedLocaleHint = sanitizeLoginPageLocaleHint(localeHint);
  if (resolvedLocaleHint !== null) {
    return resolvedLocaleHint;
  }

  for (const localeCandidate of parseAcceptLanguageHeader(acceptLanguageHeader)) {
    const resolvedLocale = sanitizeLoginPageLocaleHint(localeCandidate);
    if (resolvedLocale !== null) {
      return resolvedLocale;
    }
  }

  return DEFAULT_LOGIN_PAGE_LOCALE;
}
