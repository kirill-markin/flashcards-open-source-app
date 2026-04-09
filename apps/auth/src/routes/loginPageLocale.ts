export type LoginPageLocale = "en" | "es";

const DEFAULT_LOGIN_PAGE_LOCALE: LoginPageLocale = "en";

function normalizeLocaleValue(value: string): string {
  return value.replaceAll("_", "-").trim().toLowerCase();
}

export function sanitizeLoginPageLocaleHint(localeHint: string | null | undefined): LoginPageLocale | null {
  if (typeof localeHint !== "string") {
    return null;
  }

  const normalizedLocaleHint = normalizeLocaleValue(localeHint);
  if (normalizedLocaleHint === "") {
    return null;
  }

  const primaryLanguage = normalizedLocaleHint.split("-")[0];
  if (primaryLanguage === "en" || primaryLanguage === "es") {
    return primaryLanguage;
  }

  return null;
}

function parseAcceptLanguageHeader(acceptLanguageHeader: string | null | undefined): ReadonlyArray<string> {
  if (typeof acceptLanguageHeader !== "string" || acceptLanguageHeader.trim() === "") {
    return [];
  }

  return acceptLanguageHeader
    .split(",")
    .map((entry) => entry.split(";")[0]?.trim() ?? "")
    .filter((entry) => entry !== "");
}

export function resolveLoginPageLocale(
  localeHint: string | null | undefined,
  acceptLanguageHeader: string | null | undefined,
): LoginPageLocale {
  const resolvedLocaleHint = sanitizeLoginPageLocaleHint(localeHint);
  if (resolvedLocaleHint !== null) {
    return resolvedLocaleHint;
  }

  for (const localeCandidate of parseAcceptLanguageHeader(acceptLanguageHeader)) {
    const resolvedLocale = sanitizeLoginPageLocaleHint(localeCandidate);
    if (resolvedLocale !== null) {
      return resolvedLocale;
    }
  }

  return DEFAULT_LOGIN_PAGE_LOCALE;
}
