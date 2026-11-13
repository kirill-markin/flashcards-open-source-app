import type { Locale } from "./i18n";

const publicSiteBaseUrl: string = "https://nibomo.com";

// Mirrors the regional audiences in the website repository's src/lib/publicCatalogAudience.ts.
const publicSiteRegionalCatalogAudiences: ReadonlyMap<string, string> = new Map([
  ["en-au", "en"],
  ["en-ca", "en"],
  ["en-gb", "en"],
  ["fr-ca", "fr"],
  ["pt-pt", "pt"],
]);

// Mirrors NON_DEFAULT_LOCALES in the website repository's src/lib/localeConfig.ts.
const publicSiteNonDefaultLocales: ReadonlySet<string> = new Set([
  "es", "ar", "de", "hi", "ja", "fr", "pt", "ru", "zh", "it", "ko", "id",
  "tr", "nl", "pl", "vi", "th", "uk", "he", "sv", "da", "nb", "fi", "cs",
  "el", "ro", "hu", "fa", "ca", "bn", "gu", "kn", "ml", "mr", "pa", "ta",
  "te", "ur", "sw", "bg", "et", "hr", "is", "lt", "lv", "sk", "sl", "zu",
  "zh-hant", "ms", "or", ...publicSiteRegionalCatalogAudiences.keys(),
]);

function getPublicSiteLocale(locale: Locale): string | null {
  const siteLocale: string = locale.toLowerCase();
  if (publicSiteNonDefaultLocales.has(siteLocale)) {
    return siteLocale;
  }

  const baseLanguage: string = siteLocale.split("-")[0];
  return publicSiteNonDefaultLocales.has(baseLanguage) ? baseLanguage : null;
}

export function getPublicSiteHomeUrl(locale: Locale): string {
  const siteLocale = getPublicSiteLocale(locale);
  return siteLocale === null
    ? `${publicSiteBaseUrl}/`
    : `${publicSiteBaseUrl}/${siteLocale}/`;
}

// Mirrors getPublicCatalogRootUrl in the website repository's src/lib/publicCatalogUrls.ts.
export function getPublicSiteCatalogUrl(locale: Locale): string {
  const siteLocale = getPublicSiteLocale(locale);
  if (siteLocale === null) {
    return `${publicSiteBaseUrl}/catalog/?language=en`;
  }

  const audienceLanguage = publicSiteRegionalCatalogAudiences.get(siteLocale) ?? siteLocale;
  return `${publicSiteBaseUrl}/${siteLocale}/catalog/?language=${audienceLanguage}`;
}

// The UTM parameters record the header click: the site stores them on its page view.
export function getPublicSiteMcpUrl(locale: Locale): string {
  const siteLocale = getPublicSiteLocale(locale);
  const path: string = siteLocale === null ? "/mcp/" : `/${siteLocale}/mcp/`;
  return `${publicSiteBaseUrl}${path}?utm_source=web_app&utm_medium=referral&utm_campaign=web_app_header`;
}
