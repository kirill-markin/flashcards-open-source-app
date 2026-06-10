import { arAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/ar";
import { deAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/de";
import { enAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/en";
import { esAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/es";
import { hiAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/hi";
import { jaAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/ja";
import { ruAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/ru";
import type { AnonymousDisplayNameWordPools } from "./anonymousDisplayNames/types";
import { zhHansAnonymousDisplayNameWordPools } from "./anonymousDisplayNames/zhHans";

export type { AnonymousDisplayNameWordPools } from "./anonymousDisplayNames/types";

export const supportedAnonymousDisplayNameLocales = [
  "en",
  "ar",
  "zh-Hans",
  "de",
  "hi",
  "ja",
  "ru",
  "es-MX",
  "es-ES",
] as const;
export const defaultAnonymousDisplayNameLocale = "en" as const;
export const defaultSpanishAnonymousDisplayNameLocale = "es-ES" as const;

export type AnonymousDisplayNameLocale = (typeof supportedAnonymousDisplayNameLocales)[number];

const primaryLanguageAnonymousDisplayNameLocaleFallbacks: Readonly<Record<string, AnonymousDisplayNameLocale>> = {
  ar: "ar",
  de: "de",
  en: "en",
  hi: "hi",
  ja: "ja",
  ru: "ru",
};

const legacyAnonymousDisplayNameLocaleMap: Readonly<Record<string, AnonymousDisplayNameLocale>> = {
  en: "en",
  es: defaultSpanishAnonymousDisplayNameLocale,
};

const anonymousDisplayNameWordPoolsByLocale: Readonly<
  Record<AnonymousDisplayNameLocale, AnonymousDisplayNameWordPools>
> = {
  en: enAnonymousDisplayNameWordPools,
  ar: arAnonymousDisplayNameWordPools,
  "zh-Hans": zhHansAnonymousDisplayNameWordPools,
  de: deAnonymousDisplayNameWordPools,
  hi: hiAnonymousDisplayNameWordPools,
  ja: jaAnonymousDisplayNameWordPools,
  ru: ruAnonymousDisplayNameWordPools,
  "es-MX": esAnonymousDisplayNameWordPools,
  "es-ES": esAnonymousDisplayNameWordPools,
};

function hasOwnProperty<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): key is keyof typeof record {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isSupportedAnonymousDisplayNameLocale(value: string): value is AnonymousDisplayNameLocale {
  return supportedAnonymousDisplayNameLocales.some((supportedLocale) => supportedLocale === value);
}

function normalizeLanguageTag(languageTag: string): string | null {
  const normalizedTag = normalizeAndroidLocaleQualifier(languageTag);
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

function normalizeAndroidLocaleQualifier(languageTag: string): string {
  const trimmedTag = languageTag.replaceAll("_", "-").trim();
  if (trimmedTag.startsWith("b+")) {
    return trimmedTag.slice("b+".length).replaceAll("+", "-");
  }

  const regionalResourceQualifier = /^([a-z]{2,3})-r([a-z]{2}|[0-9]{3})$/i.exec(trimmedTag);
  if (regionalResourceQualifier === null) {
    return trimmedTag;
  }

  const language = regionalResourceQualifier[1];
  const region = regionalResourceQualifier[2];
  if (language === undefined || region === undefined) {
    throw new Error(`Invalid Android locale qualifier match: ${trimmedTag}`);
  }

  return `${language.toLowerCase()}-${region.toUpperCase()}`;
}

function resolveSpanishLocale(region: string | null): AnonymousDisplayNameLocale {
  if (region === "MX" || region === "419") {
    return "es-MX";
  }

  return defaultSpanishAnonymousDisplayNameLocale;
}

function resolveChineseLocale(script: string | null, region: string | null): AnonymousDisplayNameLocale | null {
  if (script === "Hans" || region === "CN" || region === "SG") {
    return "zh-Hans";
  }

  return null;
}

export function resolveAnonymousDisplayNameLocale(localeHint: string): AnonymousDisplayNameLocale {
  const normalizedLocale = normalizeLanguageTag(localeHint);
  if (normalizedLocale === null) {
    return defaultAnonymousDisplayNameLocale;
  }

  if (isSupportedAnonymousDisplayNameLocale(normalizedLocale)) {
    return normalizedLocale;
  }

  if (hasOwnProperty(legacyAnonymousDisplayNameLocaleMap, normalizedLocale)) {
    return legacyAnonymousDisplayNameLocaleMap[normalizedLocale];
  }

  const locale = new Intl.Locale(normalizedLocale);
  if (locale.language === "es") {
    return resolveSpanishLocale(locale.region ?? null);
  }

  if (locale.language === "zh") {
    return resolveChineseLocale(locale.script ?? null, locale.region ?? null) ?? defaultAnonymousDisplayNameLocale;
  }

  return hasOwnProperty(primaryLanguageAnonymousDisplayNameLocaleFallbacks, locale.language)
    ? primaryLanguageAnonymousDisplayNameLocaleFallbacks[locale.language]
    : defaultAnonymousDisplayNameLocale;
}

export function getAnonymousDisplayNameWordPools(localeHint: string): AnonymousDisplayNameWordPools {
  return anonymousDisplayNameWordPoolsByLocale[resolveAnonymousDisplayNameLocale(localeHint)];
}
