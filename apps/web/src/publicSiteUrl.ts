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

export function getPublicSiteHomeUrl(locale: Locale): string {
  const language = locale.split("-")[0];
  return publicSiteNonDefaultLocales.has(language)
    ? `${publicSiteBaseUrl}/${language}/`
    : `${publicSiteBaseUrl}/`;
}
