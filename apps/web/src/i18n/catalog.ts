import type { Locale } from "./types";
import { arCatalog } from "./catalogs/ar";
import { deCatalog } from "./catalogs/de";
import { enCatalog } from "./catalogs/en";
import { esEsCatalog } from "./catalogs/es-ES";
import { esMxCatalog } from "./catalogs/es-MX";
import { hiCatalog } from "./catalogs/hi";
import { jaCatalog } from "./catalogs/ja";
import { ruCatalog } from "./catalogs/ru";
import { zhHansCatalog } from "./catalogs/zh-Hans";
import type { TranslationCatalog } from "./catalogTypes";

export type { TranslationKey } from "./catalogTypes";

export type TranslationMessages = TranslationCatalog;

export const translationCatalogs: Readonly<Record<Locale, TranslationCatalog>> = {
  en: enCatalog,
  ar: arCatalog,
  "zh-Hans": zhHansCatalog,
  de: deCatalog,
  hi: hiCatalog,
  ja: jaCatalog,
  ru: ruCatalog,
  "es-MX": esMxCatalog,
  "es-ES": esEsCatalog,
};
