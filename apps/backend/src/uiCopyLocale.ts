const REGIONAL_UI_COPY_LOCALES = ["en-AU", "en-CA", "en-GB", "fr-CA", "pt-PT"] as const;

export function parseUiCopyLocale(value: string): Intl.Locale | null {
  try {
    return new Intl.Locale(value.replaceAll("_", "-").trim());
  } catch {
    return null;
  }
}

export function resolveSpecializedUiCopyLocale(
  locale: Intl.Locale,
): (typeof REGIONAL_UI_COPY_LOCALES)[number] | "ms" | "or" | "zh-Hant" | null {
  if (locale.language === "ms" || locale.language === "or") {
    return locale.language;
  }

  if (locale.language === "zh" && (
    locale.script === "Hant"
    || (locale.script === undefined && (locale.region === "TW" || locale.region === "HK" || locale.region === "MO"))
  )) {
    return "zh-Hant";
  }

  return REGIONAL_UI_COPY_LOCALES.find((tag) => tag === [locale.language, locale.region].join("-")) ?? null;
}
