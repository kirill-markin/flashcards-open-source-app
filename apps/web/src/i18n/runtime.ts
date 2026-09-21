import { getLoadedTranslationCatalog, type TranslationKey, type TranslationMessages } from "./catalog";
import {
  getDefaultLocale,
  getLocaleDirection,
  migrateLegacyLocalePreference,
  normalizeLanguageTag,
  normalizeSupportedLocale,
  resolveSupportedLocale,
} from "./locales";
import {
  autoLocalePreference,
  type DateTimeValue,
  type Locale,
  type LocaleDirection,
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
  direction: LocaleDirection;
  localePreference: LocalePreference;
  matchedBrowserLanguageTag: string | null;
  source: ResolvedLocaleSource;
}>;

export const LOCALE_PREFERENCE_STORAGE_KEY = "flashcards-web-locale-preference";
// A probe must never overwrite the preference it is probing for.
const LOCALE_PREFERENCE_PROBE_STORAGE_KEY = `${LOCALE_PREFERENCE_STORAGE_KEY}-probe`;

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
    if (normalizedLanguageTag === null || seenLanguageTags.has(normalizedLanguageTag)) {
      return candidates;
    }

    seenLanguageTags.add(normalizedLanguageTag);
    candidates.push({
      languageTag: normalizedLanguageTag,
      source: "navigator.language",
    });
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

function readLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storageValue = window.localStorage;

    if (
      typeof storageValue?.getItem !== "function"
      || typeof storageValue.setItem !== "function"
      || typeof storageValue.removeItem !== "function"
    ) {
      return null;
    }

    return storageValue;
  } catch {
    // Browsers with blocked site data throw on the localStorage getter itself; treat that as
    // storage being unavailable.
    return null;
  }
}

// Reachable storage is not usable storage: quota-exceeded storage, and the stub storage some
// privacy extensions install, throw on the operation rather than on the getter, so every read and
// write below goes through these helpers and reports unavailability instead of raising.
function readStoredValue(storageKey: string): string | null {
  const storage = readLocalStorage();
  if (storage === null) {
    return null;
  }

  try {
    return storage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredValue(storageKey: string, storageValue: string): boolean {
  const storage = readLocalStorage();
  if (storage === null) {
    return false;
  }

  try {
    storage.setItem(storageKey, storageValue);

    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(storageKey: string): boolean {
  const storage = readLocalStorage();
  if (storage === null) {
    return false;
  }

  try {
    storage.removeItem(storageKey);

    return true;
  } catch {
    return false;
  }
}

// Pinning a locale only survives a reload when the preference can be written, so a caller that
// offers that as a recovery must not offer it otherwise. Both operations are probed, because
// persisting "auto" removes the key instead of writing it.
export function canPersistLocalePreference(): boolean {
  return writeStoredValue(LOCALE_PREFERENCE_PROBE_STORAGE_KEY, autoLocalePreference) && removeStoredValue(LOCALE_PREFERENCE_PROBE_STORAGE_KEY);
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
    const locale = resolveSupportedLocale(candidate.languageTag);
    if (locale !== null) {
      return {
        locale,
        matchedLanguageTag: candidate.languageTag,
        source: candidate.source,
      };
    }
  }

  return {
    locale: getDefaultLocale(),
    matchedLanguageTag: null,
    source: "fallback",
  };
}

export function resolveBrowserLocale(): BrowserLocaleResolution {
  return resolveBrowserLocaleFromSnapshot(readBrowserLanguageSnapshot());
}

export function readStoredLocalePreference(): LocalePreference {
  const storedValue = readStoredValue(LOCALE_PREFERENCE_STORAGE_KEY);
  if (storedValue === null) {
    return autoLocalePreference;
  }

  if (storedValue === autoLocalePreference) {
    return autoLocalePreference;
  }

  const normalizedStoredLocale = normalizeSupportedLocale(storedValue);
  if (normalizedStoredLocale !== null) {
    if (normalizedStoredLocale !== storedValue) {
      writeStoredValue(LOCALE_PREFERENCE_STORAGE_KEY, normalizedStoredLocale);
    }

    return normalizedStoredLocale;
  }

  const migratedStoredLocale = migrateLegacyLocalePreference(storedValue);
  if (migratedStoredLocale !== null) {
    writeStoredValue(LOCALE_PREFERENCE_STORAGE_KEY, migratedStoredLocale);
    return migratedStoredLocale;
  }

  return autoLocalePreference;
}

export function persistLocalePreference(localePreference: LocalePreference): void {
  if (localePreference === autoLocalePreference) {
    removeStoredValue(LOCALE_PREFERENCE_STORAGE_KEY);
    return;
  }

  writeStoredValue(LOCALE_PREFERENCE_STORAGE_KEY, localePreference);
}

export function resolveLocaleState(localePreference: LocalePreference): ResolvedLocaleState {
  if (localePreference !== autoLocalePreference) {
    return {
      locale: localePreference,
      direction: getLocaleDirection(localePreference),
      localePreference,
      matchedBrowserLanguageTag: null,
      source: "storage",
    };
  }

  const browserLocale = resolveBrowserLocale();

  return {
    locale: browserLocale.locale,
    direction: getLocaleDirection(browserLocale.locale),
    localePreference,
    matchedBrowserLanguageTag: browserLocale.matchedLanguageTag,
    source: browserLocale.source,
  };
}

export function translateMessage(locale: Locale, key: TranslationKey, values: TranslationValues | undefined): string {
  const template = getTranslationTemplate(getLoadedTranslationCatalog(locale), key);

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
