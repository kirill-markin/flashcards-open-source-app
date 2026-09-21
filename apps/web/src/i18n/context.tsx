import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  getLoadedTranslationCatalog,
  isTranslationCatalogLoaded,
  loadTranslationCatalog,
  type TranslationKey,
  type TranslationMessages,
} from "./catalog";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  persistLocalePreference,
  readStoredLocalePreference,
  resolveLocaleState,
  type ResolvedLocaleState,
  selectCountLabel,
  translateMessage,
} from "./runtime";
import type { DateTimeValue, Locale, LocaleDirection, LocalePreference, PluralCountLabels, TranslationValues } from "./types";

type I18nContextValue = Readonly<ResolvedLocaleState & {
  messages: TranslationMessages;
  setLocalePreference: (localePreference: LocalePreference) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatDate: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
  formatTime: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
  formatDateTime: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
  formatNumber: (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;
  formatCount: (value: number, labels: PluralCountLabels) => string;
  // The plural label alone, for layouts that style the number separately.
  selectCountLabel: (value: number, labels: PluralCountLabels) => string;
}>;

const I18nContext = createContext<I18nContextValue | null>(null);

type Props = Readonly<{
  children: ReactNode;
}>;

// The catalog the tree is currently rendering, which lags the resolved locale while the next
// catalog chunk is still loading.
type RenderedTranslation = Readonly<{
  locale: Locale;
  direction: LocaleDirection;
  messages: TranslationMessages;
}>;

// Keyed by locale, so a failure latched for one language never blocks another one.
type CatalogLoadFailure = Readonly<{
  locale: Locale;
  error: unknown;
}>;

function readRenderedTranslation(locale: Locale, direction: LocaleDirection): RenderedTranslation | null {
  if (isTranslationCatalogLoaded(locale) === false) {
    return null;
  }

  return {
    locale,
    direction,
    messages: getLoadedTranslationCatalog(locale),
  };
}

export function I18nProvider(props: Props): ReactElement {
  const { children } = props;
  const [localePreference, setLocalePreferenceState] = useState<LocalePreference>(() => readStoredLocalePreference());
  const resolvedLocaleState = resolveLocaleState(localePreference);
  const targetLocale = resolvedLocaleState.locale;
  const targetDirection = resolvedLocaleState.direction;
  // A landed catalog chunk only has to trigger a re-render; what renders is derived below.
  const [, setLoadedCatalogRevision] = useState<number>(0);
  const [catalogLoadFailure, setCatalogLoadFailure] = useState<CatalogLoadFailure | null>(null);
  const lastRenderedTranslation = useRef<RenderedTranslation | null>(null);
  // An already loaded catalog renders in the same commit that switches to it, so a language change
  // never paints a frame of the previous language; an unloaded one keeps the catalog on screen.
  const renderedTranslation = readRenderedTranslation(targetLocale, targetDirection) ?? lastRenderedTranslation.current;
  // Read as primitives, because the rendered translation is derived and has a fresh identity on
  // every render.
  const documentLocale = renderedTranslation === null ? null : renderedTranslation.locale;
  const documentDirection = renderedTranslation === null ? null : renderedTranslation.direction;

  useEffect(() => {
    // Keyed on what actually rendered rather than on the catalog map: a chunk that lands between
    // render and this effect would otherwise leave the placeholder on screen with nothing
    // scheduled. An already cached catalog resolves immediately and converges in one more render.
    if (documentLocale === targetLocale) {
      return;
    }

    let isCurrentLocale = true;

    loadTranslationCatalog(targetLocale).then(
      () => {
        if (isCurrentLocale === false) {
          return;
        }

        // The catalog is cached by the time it resolves, so re-rendering is enough to pick it up.
        setLoadedCatalogRevision((catalogRevision) => catalogRevision + 1);
      },
      (error: unknown) => {
        if (isCurrentLocale === false) {
          return;
        }

        setCatalogLoadFailure({ locale: targetLocale, error });
      },
    );

    return () => {
      isCurrentLocale = false;
    };
  }, [documentLocale, targetLocale]);

  useLayoutEffect(() => {
    if (documentLocale === null || documentDirection === null) {
      // The boot placeholder stands in for the locale whose catalog is loading.
      document.documentElement.lang = targetLocale;
      document.documentElement.dir = targetDirection;
      return;
    }

    // What stays on screen while the chunk of the next locale downloads.
    lastRenderedTranslation.current = readRenderedTranslation(documentLocale, documentDirection);
    document.documentElement.lang = documentLocale;
    document.documentElement.dir = documentDirection;
  }, [documentDirection, documentLocale, targetDirection, targetLocale]);

  // Raised above every catalog consumer, so LocaleBootErrorFallback in main.tsx is what catches it.
  if (catalogLoadFailure !== null && catalogLoadFailure.locale === targetLocale) {
    throw catalogLoadFailure.error;
  }

  // Only the first paint of a non-default locale has no catalog at all; a later locale change keeps
  // rendering the catalog already on screen. The indicator carries no copy, because any copy here
  // would be in the wrong language.
  if (renderedTranslation === null) {
    return (
      <main className="page-state" aria-busy="true">
        <span className="page-state-spinner" />
      </main>
    );
  }

  const renderedLocale = renderedTranslation.locale;

  function setLocalePreference(nextLocalePreference: LocalePreference): void {
    // A different locale gets a fresh attempt instead of inheriting the latched failure.
    setCatalogLoadFailure(null);
    setLocalePreferenceState(nextLocalePreference);
    persistLocalePreference(nextLocalePreference);
  }

  function t(key: TranslationKey, values?: TranslationValues): string {
    return translateMessage(renderedLocale, key, values);
  }

  function formatDateValue(value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return formatDate(renderedLocale, value, options);
  }

  function formatTimeValue(value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return formatTime(renderedLocale, value, options);
  }

  function formatDateTimeValue(value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return formatDateTime(renderedLocale, value, options);
  }

  function formatNumberValue(value: number, options?: Readonly<Intl.NumberFormatOptions>): string {
    return formatNumber(renderedLocale, value, options);
  }

  function formatCountValue(value: number, labels: PluralCountLabels): string {
    return formatCount(renderedLocale, value, labels);
  }

  function selectCountLabelValue(value: number, labels: PluralCountLabels): string {
    return selectCountLabel(renderedLocale, value, labels);
  }

  return (
    <I18nContext.Provider
      value={{
        ...resolvedLocaleState,
        // The locale and direction on screen belong to the catalog that is actually rendered.
        locale: renderedLocale,
        direction: renderedTranslation.direction,
        messages: renderedTranslation.messages,
        setLocalePreference,
        t,
        formatDate: formatDateValue,
        formatTime: formatTimeValue,
        formatDateTime: formatDateTimeValue,
        formatNumber: formatNumberValue,
        formatCount: formatCountValue,
        selectCountLabel: selectCountLabelValue,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const contextValue = useContext(I18nContext);

  if (contextValue === null) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return contextValue;
}
