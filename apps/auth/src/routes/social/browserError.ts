import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { normalizeSupportedLoginPageLocale, resolveLoginPageLocale, type LoginPageLocale } from "../browser/loginPageLocale.js";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { browserAuthOrigin, requireBrowserRedirect } from "../../server/social/browserState.js";
import { AUTH_ENTRY_COPY } from "../../templates/authEntryCopy.js";
import { browserHtml, renderBrowserDocument } from "../../templates/browserCompletion.js";

export type BrowserSignInRecovery = Readonly<{ chooserUri: string; locale: LoginPageLocale; retryMethod: "apple" | null }>;

export function browserSignInRecovery(
  c: Context<AuthAppEnv>, redirectUri: string, localeHint: string | undefined,
): BrowserSignInRecovery | null {
  if (localeHint !== undefined && normalizeSupportedLoginPageLocale(localeHint) === null) return null;
  let destination: URL;
  let authOrigin: string;
  try {
    authOrigin = browserAuthOrigin(c);
    destination = new URL(requireBrowserRedirect(redirectUri, authOrigin));
  } catch (error) {
    if (error instanceof AuthAttemptError) return null;
    throw error;
  }
  const locale = resolveLoginPageLocale(localeHint, c.req.header("accept-language"));
  const chooser = destination.origin === authOrigin && destination.pathname === "/authorize"
    ? destination : new URL("/login", authOrigin);
  if (chooser !== destination) chooser.searchParams.set("redirect_uri", destination.toString());
  chooser.searchParams.set("locale", locale);
  return { chooserUri: chooser.pathname + chooser.search, locale, retryMethod: null };
}

export async function browserSignInErrorResponse(
  c: Context<AuthAppEnv>, response: Response, recovery: BrowserSignInRecovery | null,
): Promise<Response> {
  const documentRequest = (c.req.header("sec-fetch-mode") === "navigate" && c.req.header("sec-fetch-dest") === "document")
    || (c.req.header("accept") ?? "").split(",").some((value) => value.split(";")[0].trim().toLowerCase() === "text/html");
  if (recovery === null || !documentRequest) return response;
  const body = await response.clone().text();
  if (body.length > 4096) throw new Error("Auth error response exceeds the browser recovery limit");
  const result: unknown = JSON.parse(body);
  const code = result !== null && typeof result === "object" && "code" in result
    && typeof result.code === "string" && /^[A-Z_]{1,64}$/.test(result.code) ? result.code : null;
  const requestId = result !== null && typeof result === "object" && "requestId" in result
    && typeof result.requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(result.requestId) ? result.requestId : null;
  const cleanupPending = response.status === 409
    && (code === "APPLE_REVOCATION_PENDING" || code === "PROVIDER_METHOD_CLEANUP_REQUIRED");
  const nonce = randomBytes(32).toString("base64url");
  const copy = AUTH_ENTRY_COPY[recovery.locale];
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
  return c.html(renderBrowserDocument(recovery.locale, nonce, copy.title,
    `<h1>${browserHtml(copy.title)}</h1><p role="${cleanupPending ? "status" : "alert"}">${browserHtml(cleanupPending ? copy.cleanupPending : copy.notCompleted)}</p>
    ${recovery.retryMethod === "apple" ? `<p>${browserHtml(copy.returnToApp)}</p>` : ""}
    ${code === null ? "" : `<p class="hint"><code>HTTP ${response.status} · ${browserHtml(code)}${requestId === null ? "" : ` · ${browserHtml(requestId)}`}</code></p>`}
    <a id="auth-retry-methods" class="continue" href="${browserHtml(recovery.chooserUri)}">${browserHtml(recovery.retryMethod === "apple" ? copy.apple : copy.methods)}</a>`, ""),
  response.status as ContentfulStatusCode);
}
