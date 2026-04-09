import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { type TranslationKey, type TranslationMessages, translationCatalogs } from "./catalog";
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
  translateMessage,
} from "./runtime";
import type { DateTimeValue, LocalePreference, PluralCountLabels, TranslationValues } from "./types";

type I18nContextValue = Readonly<ResolvedLocaleState & {
  messages: TranslationMessages;
  setLocalePreference: (localePreference: LocalePreference) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatDate: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
  formatTime: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
  formatDateTime: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
  formatNumber: (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;
  formatCount: (value: number, labels: PluralCountLabels) => string;
}>;

const I18nContext = createContext<I18nContextValue | null>(null);

type Props = Readonly<{
  children: ReactNode;
}>;

export function I18nProvider(props: Props): ReactElement {
  const { children } = props;
  const [localePreference, setLocalePreferenceState] = useState<LocalePreference>(() => readStoredLocalePreference());
  const resolvedLocaleState = resolveLocaleState(localePreference);
  const messages = translationCatalogs[resolvedLocaleState.locale];

  useEffect(() => {
    document.documentElement.lang = resolvedLocaleState.locale;
  }, [resolvedLocaleState.locale]);

  function setLocalePreference(nextLocalePreference: LocalePreference): void {
    setLocalePreferenceState(nextLocalePreference);
    persistLocalePreference(nextLocalePreference);
  }

  function t(key: TranslationKey, values?: TranslationValues): string {
    return translateMessage(resolvedLocaleState.locale, key, values);
  }

  function formatDateValue(value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return formatDate(resolvedLocaleState.locale, value, options);
  }

  function formatTimeValue(value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return formatTime(resolvedLocaleState.locale, value, options);
  }

  function formatDateTimeValue(value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return formatDateTime(resolvedLocaleState.locale, value, options);
  }

  function formatNumberValue(value: number, options?: Readonly<Intl.NumberFormatOptions>): string {
    return formatNumber(resolvedLocaleState.locale, value, options);
  }

  function formatCountValue(value: number, labels: PluralCountLabels): string {
    return formatCount(resolvedLocaleState.locale, value, labels);
  }

  return (
    <I18nContext.Provider
      value={{
        ...resolvedLocaleState,
        messages,
        setLocalePreference,
        t,
        formatDate: formatDateValue,
        formatTime: formatTimeValue,
        formatDateTime: formatDateTimeValue,
        formatNumber: formatNumberValue,
        formatCount: formatCountValue,
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
