import { defaultLocale, type Locale } from "./types";
import { enCatalog } from "./catalogs/en";
import type { TranslationCatalog } from "./catalogTypes";
import { createStripeCatalog } from "./stripeCatalog";

export type { TranslationKey } from "./catalogTypes";

export type TranslationMessages = TranslationCatalog;

type RegionalCatalog = Readonly<{
  baseLocale: Locale;
  loadStripe?: () => Promise<TranslationCatalog["stripe"]>;
}>;

const regionalCatalogs = {
  "en-AU": { baseLocale: "en" },
  "en-CA": { baseLocale: "en" },
  "en-GB": { baseLocale: "en" },
  "fr-CA": {
    baseLocale: "fr",
    loadStripe: async () => createStripeCatalog(
      (await import("../../../backend/src/billing/stripe/copy/locales/fr-CA.json")).default,
    ),
  },
} as const satisfies Partial<Record<Locale, RegionalCatalog>>;

type CatalogLocale = Exclude<Locale, keyof typeof regionalCatalogs>;
const regionalCatalogsByLocale: Readonly<Partial<Record<Locale, RegionalCatalog & { baseLocale: CatalogLocale }>>> = regionalCatalogs;

const translationCatalogLoaders: Readonly<Record<CatalogLocale, () => Promise<TranslationCatalog>>> = {
  en: () => Promise.resolve(enCatalog),
  ar: async () => (await import("./catalogs/ar")).arCatalog,
  "zh-Hans": async () => (await import("./catalogs/zh-Hans")).zhHansCatalog,
  "zh-Hant": async () => (await import("./catalogs/zh-Hant")).zhHantCatalog,
  de: async () => (await import("./catalogs/de")).deCatalog,
  hi: async () => (await import("./catalogs/hi")).hiCatalog,
  ja: async () => (await import("./catalogs/ja")).jaCatalog,
  ru: async () => (await import("./catalogs/ru")).ruCatalog,
  "es-MX": async () => (await import("./catalogs/es-MX")).esMxCatalog,
  "es-ES": async () => (await import("./catalogs/es-ES")).esEsCatalog,
  fr: async () => (await import("./catalogs/fr")).frCatalog,
  "pt-BR": async () => (await import("./catalogs/pt-BR")).ptBrCatalog,
  "pt-PT": async () => (await import("./catalogs/pt-PT")).ptPtCatalog,
  it: async () => (await import("./catalogs/it")).itCatalog,
  ko: async () => (await import("./catalogs/ko")).koCatalog,
  id: async () => (await import("./catalogs/id")).idCatalog,
  tr: async () => (await import("./catalogs/tr")).trCatalog,
  nl: async () => (await import("./catalogs/nl")).nlCatalog,
  pl: async () => (await import("./catalogs/pl")).plCatalog,
  vi: async () => (await import("./catalogs/vi")).viCatalog,
  th: async () => (await import("./catalogs/th")).thCatalog,
  uk: async () => (await import("./catalogs/uk")).ukCatalog,
  he: async () => (await import("./catalogs/he")).heCatalog,
  sv: async () => (await import("./catalogs/sv")).svCatalog,
  da: async () => (await import("./catalogs/da")).daCatalog,
  nb: async () => (await import("./catalogs/nb")).nbCatalog,
  fi: async () => (await import("./catalogs/fi")).fiCatalog,
  cs: async () => (await import("./catalogs/cs")).csCatalog,
  el: async () => (await import("./catalogs/el")).elCatalog,
  ro: async () => (await import("./catalogs/ro")).roCatalog,
  hu: async () => (await import("./catalogs/hu")).huCatalog,
  fa: async () => (await import("./catalogs/fa")).faCatalog,
  ca: async () => (await import("./catalogs/ca")).caCatalog,
  bn: async () => (await import("./catalogs/bn")).bnCatalog,
  gu: async () => (await import("./catalogs/gu")).guCatalog,
  kn: async () => (await import("./catalogs/kn")).knCatalog,
  ml: async () => (await import("./catalogs/ml")).mlCatalog,
  mr: async () => (await import("./catalogs/mr")).mrCatalog,
  ms: async () => (await import("./catalogs/ms")).msCatalog,
  or: async () => (await import("./catalogs/or")).orCatalog,
  pa: async () => (await import("./catalogs/pa")).paCatalog,
  ta: async () => (await import("./catalogs/ta")).taCatalog,
  te: async () => (await import("./catalogs/te")).teCatalog,
  ur: async () => (await import("./catalogs/ur")).urCatalog,
  sw: async () => (await import("./catalogs/sw")).swCatalog,
  bg: async () => (await import("./catalogs/bg")).bgCatalog,
  et: async () => (await import("./catalogs/et")).etCatalog,
  hr: async () => (await import("./catalogs/hr")).hrCatalog,
  is: async () => (await import("./catalogs/is")).isCatalog,
  lt: async () => (await import("./catalogs/lt")).ltCatalog,
  lv: async () => (await import("./catalogs/lv")).lvCatalog,
  sk: async () => (await import("./catalogs/sk")).skCatalog,
  sl: async () => (await import("./catalogs/sl")).slCatalog,
  zu: async () => (await import("./catalogs/zu")).zuCatalog,
};

// Pre-seeded with the default locale so it never waits for a chunk.
const loadedTranslationCatalogs = new Map<Locale, TranslationCatalog>([[defaultLocale, enCatalog]]);
const pendingTranslationCatalogLoads = new Map<Locale, Promise<TranslationCatalog>>();

function getCatalogCacheKey(locale: Locale): Locale {
  const regionalCatalog = regionalCatalogsByLocale[locale];
  return regionalCatalog?.loadStripe === undefined ? regionalCatalog?.baseLocale ?? locale : locale;
}

function requestTranslationCatalog(locale: Locale): Promise<TranslationCatalog> {
  const regionalCatalog = regionalCatalogsByLocale[locale];
  if (regionalCatalog?.loadStripe !== undefined) {
    return Promise.all([loadTranslationCatalog(regionalCatalog.baseLocale), regionalCatalog.loadStripe()])
      .then(([catalog, stripe]) => ({ ...catalog, stripe }));
  }

  return translationCatalogLoaders[locale as CatalogLocale]();
}

export function isTranslationCatalogLoaded(locale: Locale): boolean {
  return loadedTranslationCatalogs.has(getCatalogCacheKey(locale));
}

export function loadTranslationCatalog(locale: Locale): Promise<TranslationCatalog> {
  const catalogKey = getCatalogCacheKey(locale);
  const cachedCatalog = loadedTranslationCatalogs.get(catalogKey);
  if (cachedCatalog !== undefined) {
    return Promise.resolve(cachedCatalog);
  }

  // Concurrent callers, and a retry that races an attempt still in flight, share one chunk request.
  const pendingLoad = pendingTranslationCatalogLoads.get(catalogKey);
  if (pendingLoad !== undefined) {
    return pendingLoad;
  }

  const startedLoad = requestTranslationCatalog(catalogKey)
    .then((catalog) => {
      loadedTranslationCatalogs.set(catalogKey, catalog);
      return catalog;
    })
    // Cleared on rejection too, so the map only ever holds an attempt still in flight.
    .finally(() => {
      pendingTranslationCatalogLoads.delete(catalogKey);
    });

  pendingTranslationCatalogLoads.set(catalogKey, startedLoad);

  return startedLoad;
}

export function getLoadedTranslationCatalog(locale: Locale): TranslationCatalog {
  const loadedCatalog = loadedTranslationCatalogs.get(getCatalogCacheKey(locale));
  if (loadedCatalog === undefined) {
    throw new Error(`Translation catalog for locale "${locale}" is not loaded; await loadTranslationCatalog("${locale}") before translating`);
  }

  return loadedCatalog;
}
