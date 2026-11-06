import type { Locale } from "./i18n";

const publicSiteBaseUrl: string = "https://nibomo.com";

// Mirrors NON_DEFAULT_LOCALES in the website repository's src/lib/localeConfig.ts;
// English and every language the site does not translate live at the root.
const publicSiteNonDefaultLocales: ReadonlySet<string> = new Set([
  "es", "ar", "de", "hi", "ja", "fr", "pt", "ru", "zh", "it", "ko", "id",
  "tr", "nl", "pl", "vi", "th", "uk", "he", "sv", "da", "nb", "fi", "cs",
  "el", "ro", "hu", "fa", "ca", "bn", "gu", "kn", "ml", "mr", "pa", "ta",
  "te", "ur", "sw", "bg", "et", "hr", "is", "lt", "lv", "sk", "sl", "zu",
]);

function getPublicSiteLanguage(locale: Locale): string | null {
  const language = locale.split("-")[0];
  return publicSiteNonDefaultLocales.has(language) ? language : null;
}

export function getPublicSiteHomeUrl(locale: Locale): string {
  const language = getPublicSiteLanguage(locale);
  return language === null
    ? `${publicSiteBaseUrl}/`
    : `${publicSiteBaseUrl}/${language}/`;
}

// Mirrors getPublicCatalogRootUrl in the website repository's src/lib/publicCatalogUrls.ts.
export function getPublicSiteCatalogUrl(locale: Locale): string {
  const language = getPublicSiteLanguage(locale);
  return language === null
    ? `${publicSiteBaseUrl}/catalog/?language=en`
    : `${publicSiteBaseUrl}/${language}/catalog/?language=${language}`;
}
