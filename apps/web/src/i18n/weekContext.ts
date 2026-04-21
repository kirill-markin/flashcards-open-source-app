import { defaultLocale, type Locale } from "./types";
import { normalizeLanguageTag, resolveSupportedLocale } from "./locales";

type IntlWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type IntlWeekInfo = Readonly<{
  firstDay: IntlWeekday;
}>;

export type LocaleWeekContext = Readonly<{
  firstDayOfWeek: WeekdayIndex;
}>;

const localeFirstDayFallbacks: Readonly<Record<Locale, IntlWeekday>> = {
  en: 7,
  ar: 6,
  "zh-Hans": 1,
  de: 1,
  hi: 7,
  ja: 7,
  ru: 1,
  "es-MX": 7,
  "es-ES": 1,
};

function isIntlWeekday(value: number): value is IntlWeekday {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

function convertIntlWeekdayToIndex(value: IntlWeekday): WeekdayIndex {
  return (value % 7) as WeekdayIndex;
}

function readWeekInfoFromIntlLocale(languageTag: string): IntlWeekInfo | null {
  if (typeof Intl.Locale !== "function") {
    return null;
  }

  const intlLocale = new Intl.Locale(languageTag) as Intl.Locale & Readonly<{
    getWeekInfo?: () => Readonly<{
      firstDay?: number;
    }>;
    weekInfo?: Readonly<{
      firstDay?: number;
    }>;
  }>;

  const weekInfo = typeof intlLocale.getWeekInfo === "function"
    ? intlLocale.getWeekInfo()
    : intlLocale.weekInfo;
  const firstDay = weekInfo?.firstDay;
  if (firstDay === undefined || isIntlWeekday(firstDay) === false) {
    return null;
  }

  return {
    firstDay,
  };
}

export function resolveLocaleWeekContext(languageTag: string, fallbackLocale?: Locale): LocaleWeekContext {
  const normalizedLanguageTag = normalizeLanguageTag(languageTag) ?? languageTag;
  const weekInfo = readWeekInfoFromIntlLocale(normalizedLanguageTag);
  const supportedLocale = fallbackLocale ?? resolveSupportedLocale(normalizedLanguageTag) ?? defaultLocale;
  const firstDay = weekInfo?.firstDay ?? localeFirstDayFallbacks[supportedLocale];

  return {
    firstDayOfWeek: convertIntlWeekdayToIndex(firstDay),
  };
}
