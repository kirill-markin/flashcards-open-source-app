import { defaultLocale, type Locale } from "./types";
import { enCatalog } from "./catalogs/en";
import type { TranslationCatalog } from "./catalogTypes";

export type { TranslationKey } from "./catalogTypes";

export type TranslationMessages = TranslationCatalog;

// One dynamic import per locale, so a browser downloads only the catalogs it renders instead of
// every supported language. The default locale stays statically imported with the app shell.
const translationCatalogLoaders: Readonly<Record<Locale, () => Promise<TranslationCatalog>>> = {
  en: () => Promise.resolve(enCatalog),
  ar: async () => (await import("./catalogs/ar")).arCatalog,
  "zh-Hans": async () => (await import("./catalogs/zh-Hans")).zhHansCatalog,
  de: async () => (await import("./catalogs/de")).deCatalog,
  hi: async () => (await import("./catalogs/hi")).hiCatalog,
  ja: async () => (await import("./catalogs/ja")).jaCatalog,
  ru: async () => (await import("./catalogs/ru")).ruCatalog,
  "es-MX": async () => (await import("./catalogs/es-MX")).esMxCatalog,
  "es-ES": async () => (await import("./catalogs/es-ES")).esEsCatalog,
  fr: async () => (await import("./catalogs/fr")).frCatalog,
  "pt-BR": async () => (await import("./catalogs/pt-BR")).ptBrCatalog,
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
};

// Pre-seeded with the default locale so it never waits for a chunk.
const loadedTranslationCatalogs = new Map<Locale, TranslationCatalog>([[defaultLocale, enCatalog]]);
const pendingTranslationCatalogLoads = new Map<Locale, Promise<TranslationCatalog>>();

export function isTranslationCatalogLoaded(locale: Locale): boolean {
  return loadedTranslationCatalogs.has(locale);
}

export function loadTranslationCatalog(locale: Locale): Promise<TranslationCatalog> {
  const cachedCatalog = loadedTranslationCatalogs.get(locale);
  if (cachedCatalog !== undefined) {
    return Promise.resolve(cachedCatalog);
  }

  // Concurrent callers, and a retry that races an attempt still in flight, share one chunk request.
  const pendingLoad = pendingTranslationCatalogLoads.get(locale);
  if (pendingLoad !== undefined) {
    return pendingLoad;
  }

  const startedLoad = translationCatalogLoaders[locale]()
    .then((catalog) => {
      loadedTranslationCatalogs.set(locale, catalog);
      return catalog;
    })
    // Cleared on rejection too, so the map only ever holds an attempt still in flight.
    .finally(() => {
      pendingTranslationCatalogLoads.delete(locale);
    });

  pendingTranslationCatalogLoads.set(locale, startedLoad);

  return startedLoad;
}

export function getLoadedTranslationCatalog(locale: Locale): TranslationCatalog {
  const loadedCatalog = loadedTranslationCatalogs.get(locale);
  if (loadedCatalog === undefined) {
    throw new Error(`Translation catalog for locale "${locale}" is not loaded; await loadTranslationCatalog("${locale}") before translating`);
  }

  return loadedCatalog;
}
