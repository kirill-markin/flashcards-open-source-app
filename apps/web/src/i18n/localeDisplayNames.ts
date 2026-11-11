import type { Locale } from "./types";

export type LocaleDisplayName = {
  readonly nativeName: string;
  readonly englishName: string;
  readonly searchAliases: ReadonlyArray<string>;
};

// The picker uses native and English names regardless of the current app language.
export const localeDisplayNames: Readonly<Record<Locale, LocaleDisplayName>> = {
  en: { nativeName: "English", englishName: "English", searchAliases: [] },
  "en-AU": {
    nativeName: "English (Australia)",
    englishName: "English (Australia)",
    searchAliases: ["Australian English"],
  },
  "en-CA": {
    nativeName: "English (Canada)",
    englishName: "English (Canada)",
    searchAliases: ["Canadian English"],
  },
  "en-GB": {
    nativeName: "English (United Kingdom)",
    englishName: "English (United Kingdom)",
    searchAliases: ["British English", "en-UK"],
  },
  ar: { nativeName: "العربية", englishName: "Arabic", searchAliases: ["arabi"] },
  "zh-Hans": {
    nativeName: "简体中文",
    englishName: "Chinese (Simplified)",
    searchAliases: ["mandarin", "chinese", "zhongwen", "中文", "普通话"],
  },
  "zh-Hant": {
    nativeName: "繁體中文",
    englishName: "Chinese (Traditional)",
    searchAliases: ["Traditional Chinese", "zh-TW", "zh-HK", "zh-MO", "mandarin", "zhongwen", "中文", "普通話"],
  },
  de: { nativeName: "Deutsch", englishName: "German", searchAliases: [] },
  hi: { nativeName: "हिन्दी", englishName: "Hindi", searchAliases: [] },
  ja: { nativeName: "日本語", englishName: "Japanese", searchAliases: ["nihongo"] },
  ru: { nativeName: "Русский", englishName: "Russian", searchAliases: ["russkiy"] },
  "es-MX": {
    nativeName: "Español (México)",
    englishName: "Spanish (Mexico)",
    searchAliases: ["latino", "latin american spanish", "mexico"],
  },
  "es-ES": {
    nativeName: "Español (España)",
    englishName: "Spanish (Spain)",
    searchAliases: ["castellano", "spanish", "spain"],
  },
  fr: { nativeName: "Français", englishName: "French", searchAliases: [] },
  "fr-CA": {
    nativeName: "français (Canada)",
    englishName: "French (Canada)",
    searchAliases: ["Canadian French", "français canadien"],
  },
  "pt-BR": {
    nativeName: "Português (Brasil)",
    englishName: "Portuguese (Brazil)",
    searchAliases: ["brasileiro", "brazilian", "portuguese"],
  },
  "pt-PT": {
    nativeName: "Português (Portugal)",
    englishName: "Portuguese (Portugal)",
    searchAliases: ["European Portuguese", "português europeu"],
  },
  it: { nativeName: "Italiano", englishName: "Italian", searchAliases: [] },
  ko: { nativeName: "한국어", englishName: "Korean", searchAliases: ["hangugeo", "hangul"] },
  id: {
    nativeName: "Bahasa Indonesia",
    englishName: "Indonesian",
    searchAliases: ["bahasa", "bahasa indonesia"],
  },
  tr: { nativeName: "Türkçe", englishName: "Turkish", searchAliases: [] },
  nl: { nativeName: "Nederlands", englishName: "Dutch", searchAliases: ["flemish"] },
  pl: { nativeName: "Polski", englishName: "Polish", searchAliases: [] },
  vi: { nativeName: "Tiếng Việt", englishName: "Vietnamese", searchAliases: [] },
  th: { nativeName: "ไทย", englishName: "Thai", searchAliases: ["phasa thai"] },
  uk: { nativeName: "Українська", englishName: "Ukrainian", searchAliases: ["ukrainska"] },
  he: { nativeName: "עברית", englishName: "Hebrew", searchAliases: ["ivrit"] },
  sv: { nativeName: "Svenska", englishName: "Swedish", searchAliases: [] },
  da: { nativeName: "Dansk", englishName: "Danish", searchAliases: [] },
  nb: {
    nativeName: "Norsk bokmål",
    englishName: "Norwegian Bokmål",
    searchAliases: ["norwegian", "bokmal", "norsk"],
  },
  fi: { nativeName: "Suomi", englishName: "Finnish", searchAliases: [] },
  cs: { nativeName: "Čeština", englishName: "Czech", searchAliases: [] },
  el: { nativeName: "Ελληνικά", englishName: "Greek", searchAliases: ["ellinika"] },
  ro: { nativeName: "Română", englishName: "Romanian", searchAliases: [] },
  hu: { nativeName: "Magyar", englishName: "Hungarian", searchAliases: [] },
  fa: { nativeName: "فارسی", englishName: "Persian", searchAliases: ["farsi", "persian"] },
  ca: { nativeName: "Català", englishName: "Catalan", searchAliases: ["valencia"] },
  bn: { nativeName: "বাংলা", englishName: "Bangla", searchAliases: ["bengali"] },
  gu: { nativeName: "ગુજરાતી", englishName: "Gujarati", searchAliases: [] },
  kn: { nativeName: "ಕನ್ನಡ", englishName: "Kannada", searchAliases: [] },
  ml: { nativeName: "മലയാളം", englishName: "Malayalam", searchAliases: [] },
  mr: { nativeName: "मराठी", englishName: "Marathi", searchAliases: [] },
  ms: { nativeName: "Bahasa Melayu", englishName: "Malay", searchAliases: ["ms-MY"] },
  or: { nativeName: "ଓଡ଼ିଆ", englishName: "Odia", searchAliases: ["Oriya", "or-IN"] },
  pa: { nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi", searchAliases: ["panjabi", "gurmukhi"] },
  ta: { nativeName: "தமிழ்", englishName: "Tamil", searchAliases: [] },
  te: { nativeName: "తెలుగు", englishName: "Telugu", searchAliases: [] },
  ur: { nativeName: "اردو", englishName: "Urdu", searchAliases: [] },
  sw: { nativeName: "Kiswahili", englishName: "Swahili", searchAliases: [] },
  bg: { nativeName: "Български", englishName: "Bulgarian", searchAliases: ["balgarski"] },
  et: { nativeName: "Eesti", englishName: "Estonian", searchAliases: [] },
  hr: { nativeName: "Hrvatski", englishName: "Croatian", searchAliases: [] },
  is: { nativeName: "Íslenska", englishName: "Icelandic", searchAliases: [] },
  lt: { nativeName: "Lietuvių", englishName: "Lithuanian", searchAliases: [] },
  lv: { nativeName: "Latviešu", englishName: "Latvian", searchAliases: [] },
  sk: { nativeName: "Slovenčina", englishName: "Slovak", searchAliases: [] },
  sl: { nativeName: "Slovenščina", englishName: "Slovenian", searchAliases: ["slovene"] },
  zu: { nativeName: "isiZulu", englishName: "Zulu", searchAliases: [] },
};

export function formatLocaleDisplayName(
  locale: Locale,
  displayLocale: Locale,
  localizedNames: Readonly<Partial<Record<Locale, string>>>,
): string {
  const catalogName = localizedNames[locale];
  if (catalogName !== undefined) {
    return catalogName;
  }

  if (typeof Intl.DisplayNames !== "function") {
    return localeDisplayNames[locale].englishName;
  }

  const displayNames = new Intl.DisplayNames([displayLocale, "en"], {
    type: "language",
    languageDisplay: "standard",
    fallback: "none",
  });

  return displayNames.of(locale) ?? localeDisplayNames[locale].englishName;
}

// Case-, accent-, and whitespace-insensitive, so "espanol" matches "Español".
function normalizeLocaleSearchText(text: string): string {
  return text
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesLocaleSearch(locale: Locale, query: string): boolean {
  const normalizedQuery = normalizeLocaleSearchText(query);
  if (normalizedQuery === "") {
    return true;
  }

  const displayName = localeDisplayNames[locale];
  return [locale, displayName.nativeName, displayName.englishName, ...displayName.searchAliases].some(
    (candidate) => normalizeLocaleSearchText(candidate).includes(normalizedQuery),
  );
}
