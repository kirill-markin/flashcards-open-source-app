import { randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeSupportedLoginPageLocale, type LoginPageLocale } from "../../routes/browser/loginPageLocale.js";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "../crypto.js";
import type { AuthAnalyticsContext } from "../analytics/signInFunnel.js";
import { AuthAttemptError, requireAuthHandle, type AuthAttemptBinding } from "./attemptContract.js";
import type { IdentityProvider } from "./identityStore.js";
import { socialAuthOrigins } from "./providers.js";

export const androidAppleReturnUri = "com.nibomo.app:/auth/social/apple";
const cookiePrefix = "__Host-social_callback_";
const cookieOptions = { path: "/", secure: true, httpOnly: true, sameSite: "None" as const };
const browserStateBrand: unique symbol = Symbol("verified browser callback cookie");

type BrowserStateFields = Readonly<{
  connectionOperation?: string;
  version: "social-browser-v1";
  authOrigin: string;
  attempt: string;
  provider: IdentityProvider;
  state: string;
  expiresAt: number;
  phase: "provider" | "mailbox";
  analytics: AuthAnalyticsContext;
  intent: "login" | "reauth" | "link" | "reenable";
}> & (Readonly<{ client: "web"; browserSecret: string; redirectUri: string; locale?: LoginPageLocale }>
  | Readonly<{ client: "android"; codeChallenge: string }>);
export type BrowserCallbackState = BrowserStateFields & Readonly<{ [browserStateBrand]: true }>;

export function browserAuthOrigin(c: Context): string {
  const origin = new URL(c.req.url).origin;
  if (!socialAuthOrigins.includes(origin)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return origin;
}

/** Only product origins or this host's consent page may be an intended destination. */
export function requireBrowserRedirect(value: string, authOrigin: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthAttemptError("AUTH_ATTEMPT_INVALID"); }
  const allowedOrigins = (process.env.ALLOWED_REDIRECT_URIS ?? "").split(",").map((entry) => entry.trim());
  if (url.toString().length > 2000 || url.username !== "" || url.password !== ""
    || (url.protocol !== "https:" && url.protocol !== "http:")
    || !(allowedOrigins.includes(url.origin) || (url.origin === authOrigin && url.pathname === "/authorize"))) {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
  return url.toString();
}

export function createBrowserState(
  authOrigin: string, provider: IdentityProvider, attempt: string, expiresAt: string,
  binding: Readonly<{ client: "web"; browserSecret: string; redirectUri: string; locale?: LoginPageLocale }> | Readonly<{ client: "android"; codeChallenge: string }>,
  analytics: AuthAnalyticsContext, intent: BrowserStateFields["intent"],
): BrowserStateFields {
  return { version: "social-browser-v1", authOrigin, provider, attempt, expiresAt: Date.parse(expiresAt),
    state: randomBytes(32).toString("base64url"), phase: "provider", analytics, intent, ...binding };
}

export function writeBrowserState(c: Context, state: BrowserStateFields): void {
  const signed = sign(JSON.stringify(state));
  if (signed.length > 4000) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  setCookie(c, cookiePrefix + state.state, signed, { ...cookieOptions,
    maxAge: Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000)) });
}

export function clearBrowserState(c: Context, state: BrowserCallbackState): void {
  deleteCookie(c, cookiePrefix + state.state, cookieOptions);
}

export function readBrowserState(c: Context, token: string): BrowserCallbackState {
  requireAuthHandle(token);
  let state: BrowserStateFields;
  try {
    const signed = getCookie(c, cookiePrefix + token);
    if (signed === undefined || signed.length > 4000) throw new Error("Missing callback cookie");
    state = JSON.parse(verify(signed)) as BrowserStateFields;
    state = { ...state, intent: state.intent ?? "login" };
    if (state.version !== "social-browser-v1" || state.authOrigin !== browserAuthOrigin(c)
      || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= Date.now()
      || (state.provider !== "apple" && state.provider !== "google")
      || !["login", "reauth", "link", "reenable"].includes(state.intent)
      || (state.phase !== "provider" && state.phase !== "mailbox")) throw new Error("Invalid callback cookie");
    if (state.connectionOperation !== undefined) {
      requireAuthHandle(state.connectionOperation);
      if (state.intent !== "login" || state.phase !== "provider") throw new Error("Invalid connection callback phase");
    }
    requireAuthHandle(state.attempt);
    requireAuthHandle(state.state);
    if (state.client === "web") {
      if (state.locale !== undefined && (typeof state.locale !== "string"
        || normalizeSupportedLoginPageLocale(state.locale) !== state.locale)) throw new Error("Invalid callback locale");
      requireAuthHandle(state.browserSecret);
      requireBrowserRedirect(state.redirectUri, state.authOrigin);
    } else if (state.client !== "android" || state.provider !== "apple" || state.phase !== "provider"
      || !/^[A-Za-z0-9_-]{43}$/.test(state.codeChallenge)) throw new Error("Invalid callback client");
  } catch {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
  const verified = { ...state, [browserStateBrand]: true as const };
  requireBrowserStateToken(verified, token);
  return verified;
}

export function requireBrowserStateToken(state: BrowserCallbackState, supplied: string): void {
  const expected = Buffer.from(state.state);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
}

export function browserAttemptBinding(state: BrowserCallbackState): AuthAttemptBinding & Readonly<{ client: "web" }> {
  if (state.client !== "web") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return { client: "web", purpose: state.intent === "reenable" ? "link" : state.intent, origin: state.authOrigin, browserSecret: state.browserSecret };
}
