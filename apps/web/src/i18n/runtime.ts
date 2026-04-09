import { type TranslationKey, type TranslationMessages, translationCatalogs } from "./catalog";
import {
  autoLocalePreference,
  supportedLocales,
  type DateTimeValue,
  type Locale,
  type LocalePreference,
  type PluralCountLabels,
  type TranslationValues,
} from "./types";

interface TranslationCatalogNode {
  readonly [key: string]: string | TranslationCatalogNode;
}

type BrowserLocaleSource = "fallback" | "navigator.language" | "navigator.languages";
type ResolvedLocaleSource = BrowserLocaleSource | "storage";

type BrowserLanguageCandidate = Readonly<{
  languageTag: string;
  source: BrowserLocaleSource;
}>;

export type BrowserLanguageSnapshot = Readonly<{
  language: string | null;
  languages: ReadonlyArray<string>;
}>;

export type BrowserLocaleResolution = Readonly<{
  locale: Locale;
  matchedLanguageTag: string | null;
  source: BrowserLocaleSource;
}>;

export type ResolvedLocaleState = Readonly<{
  locale: Locale;
  localePreference: LocalePreference;
  matchedBrowserLanguageTag: string | null;
  source: ResolvedLocaleSource;
}>;

const LOCALE_PREFERENCE_STORAGE_KEY = "flashcards-web-locale-preference";

function isSupportedLocale(value: string): value is Locale {
  return supportedLocales.includes(value as Locale);
}

function isLocalePreference(value: string): value is LocalePreference {
  return value === autoLocalePreference || isSupportedLocale(value);
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

function matchSupportedLocale(languageTag: string): Locale | null {
  const normalizedLanguageTag = normalizeLanguageTag(languageTag);

  if (normalizedLanguageTag === null) {
    return null;
  }

  const primaryLanguage = normalizedLanguageTag.split("-")[0]?.toLocaleLowerCase();
  if (primaryLanguage === undefined) {
    return null;
  }

  return isSupportedLocale(primaryLanguage) ? primaryLanguage : null;
}

function buildBrowserLanguageCandidates(snapshot: BrowserLanguageSnapshot): ReadonlyArray<BrowserLanguageCandidate> {
  const candidates: Array<BrowserLanguageCandidate> = [];
  const seenLanguageTags = new Set<string>();

  for (const languageTag of snapshot.languages) {
    const normalizedLanguageTag = normalizeLanguageTag(languageTag);
    if (normalizedLanguageTag === null || seenLanguageTags.has(normalizedLanguageTag)) {
      continue;
    }

    seenLanguageTags.add(normalizedLanguageTag);
    candidates.push({
      languageTag: normalizedLanguageTag,
      source: "navigator.languages",
    });
  }

  if (snapshot.language !== null) {
    const normalizedLanguageTag = normalizeLanguageTag(snapshot.language);
    if (normalizedLanguageTag !== null && seenLanguageTags.has(normalizedLanguageTag) === false) {
      candidates.push({
        languageTag: normalizedLanguageTag,
        source: "navigator.language",
      });
    }
  }

  return candidates;
}

function parseDateTimeValue(value: DateTimeValue): Date {
  const dateValue = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(dateValue.getTime())) {
    throw new Error(`Invalid date/time value: ${String(value)}`);
  }

  return dateValue;
}

function interpolateMessage(template: string, values: TranslationValues | undefined): string {
  if (values === undefined) {
    return template;
  }

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, tokenName: string) => {
    const tokenValue = values[tokenName];

    return tokenValue === undefined ? match : String(tokenValue);
  });
}

function getTranslationTemplate(messages: TranslationMessages, key: TranslationKey): string {
  const segments = key.split(".");
  let currentValue: string | TranslationCatalogNode = messages as TranslationCatalogNode;

  for (const segment of segments) {
    if (typeof currentValue === "string") {
      throw new Error(`Translation key "${key}" resolved before reaching a leaf value`);
    }

    if (Object.prototype.hasOwnProperty.call(currentValue, segment) === false) {
      throw new Error(`Missing translation key "${key}"`);
    }

    currentValue = currentValue[segment] as string | TranslationCatalogNode;
  }

  if (typeof currentValue !== "string") {
    throw new Error(`Translation key "${key}" did not resolve to a string value`);
  }

  return currentValue;
}

function canUseLocalStorage(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.localStorage?.getItem === "function"
    && typeof window.localStorage?.setItem === "function"
    && typeof window.localStorage?.removeItem === "function"
  );
}

export function readBrowserLanguageSnapshot(): BrowserLanguageSnapshot {
  if (typeof navigator === "undefined") {
    return {
      language: null,
      languages: [],
    };
  }

  const languages = Array.isArray(navigator.languages) ? navigator.languages.filter((languageTag) => languageTag.trim() !== "") : [];
  const language = typeof navigator.language === "string" && navigator.language.trim() !== "" ? navigator.language : null;

  return {
    language,
    languages,
  };
}

export function resolveBrowserLocaleFromSnapshot(snapshot: BrowserLanguageSnapshot): BrowserLocaleResolution {
  const candidates = buildBrowserLanguageCandidates(snapshot);

  for (const candidate of candidates) {
    const locale = matchSupportedLocale(candidate.languageTag);
    if (locale !== null) {
      return {
        locale,
        matchedLanguageTag: candidate.languageTag,
        source: candidate.source,
      };
    }
  }

  return {
    locale: "en",
    matchedLanguageTag: null,
    source: "fallback",
  };
}

export function resolveBrowserLocale(): BrowserLocaleResolution {
  return resolveBrowserLocaleFromSnapshot(readBrowserLanguageSnapshot());
}

export function readStoredLocalePreference(): LocalePreference {
  if (canUseLocalStorage() === false) {
    return autoLocalePreference;
  }

  const storedValue = window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY);
  if (storedValue === null) {
    return autoLocalePreference;
  }

  return isLocalePreference(storedValue) ? storedValue : autoLocalePreference;
}

export function persistLocalePreference(localePreference: LocalePreference): void {
  if (canUseLocalStorage() === false) {
    return;
  }

  if (localePreference === autoLocalePreference) {
    window.localStorage.removeItem(LOCALE_PREFERENCE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, localePreference);
}

export function resolveLocaleState(localePreference: LocalePreference): ResolvedLocaleState {
  if (localePreference !== autoLocalePreference) {
    return {
      locale: localePreference,
      localePreference,
      matchedBrowserLanguageTag: null,
      source: "storage",
    };
  }

  const browserLocale = resolveBrowserLocale();

  return {
    locale: browserLocale.locale,
    localePreference,
    matchedBrowserLanguageTag: browserLocale.matchedLanguageTag,
    source: browserLocale.source,
  };
}

export function translateMessage(locale: Locale, key: TranslationKey, values: TranslationValues | undefined): string {
  const template = getTranslationTemplate(translationCatalogs[locale], key);

  return interpolateMessage(template, values);
}

export function formatDate(locale: Locale, value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
  return new Intl.DateTimeFormat(locale, options).format(parseDateTimeValue(value));
}

export function formatTime(locale: Locale, value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
  return new Intl.DateTimeFormat(locale, options).format(parseDateTimeValue(value));
}

export function formatDateTime(locale: Locale, value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
  return new Intl.DateTimeFormat(locale, options).format(parseDateTimeValue(value));
}

export function formatNumber(locale: Locale, value: number, options?: Readonly<Intl.NumberFormatOptions>): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCount(locale: Locale, value: number, labels: PluralCountLabels): string {
  const pluralCategory = value === 0 && labels.zero !== undefined ? "zero" : new Intl.PluralRules(locale).select(value);
  const label = pluralCategory === "one" ? labels.one : pluralCategory === "zero" ? labels.zero ?? labels.other : labels.other;

  return `${formatNumber(locale, value)} ${label}`;
}
