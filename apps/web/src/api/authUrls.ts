import { getAppConfig } from "../config";
import { getDefaultLocale, resolveSupportedLocale } from "../i18n/locales";
import { readStoredLocalePreference, resolveLocaleState } from "../i18n/runtime";
import type { Locale } from "../i18n/types";

export type AuthUiLocale = Locale;

function normalizeAuthUiLocale(localeHint: string): AuthUiLocale | null {
  return resolveSupportedLocale(localeHint);
}

export function getPreferredAuthUiLocale(): AuthUiLocale {
  const resolvedLocale = normalizeAuthUiLocale(resolveLocaleState(readStoredLocalePreference()).locale);
  return resolvedLocale ?? getDefaultLocale();
}

/**
 * Builds an auth login URL that preserves the exact in-app location the user
 * should return to after silent refresh or interactive sign-in completes.
 */
export function buildLoginUrl(returnUrl: string, localeHint: string): string {
  const config = getAppConfig();
  const loginUrl = new URL(`${config.authBaseUrl}/login`);
  loginUrl.searchParams.set("redirect_uri", returnUrl);

  const sanitizedLocaleHint = normalizeAuthUiLocale(localeHint);
  if (sanitizedLocaleHint !== null) {
    loginUrl.searchParams.set("locale", sanitizedLocaleHint);
  }

  return loginUrl.toString();
}

export function buildLogoutUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/logout?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export function buildLogoutLocalUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/logout-local?redirect_uri=${encodeURIComponent(redirectUri)}`;
}
