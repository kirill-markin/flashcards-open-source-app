/**
 * Login page route. Validates redirect_uri origin against ALLOWED_REDIRECT_URIS
 * and serves the localized HTML login page.
 *
 * The redirect_uri may include a path so the user returns to the page they
 * originally visited after login. Only the origin is validated.
 */
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  createAuthAnalyticsVisitor,
  readAuthAnalyticsVisitor,
  writeAuthAnalyticsVisitor,
} from "../../server/analytics/visitorSession.js";
import { validateSessionToken } from "../../server/browserSession.js";
import { log, logWarning } from "../../server/logger.js";
import { resolveLoginPageLocale } from "./loginPageLocale.js";
import { renderLoginPage } from "../../templates/login.js";

const app = new Hono();

const getAllowedOrigins = (): ReadonlyArray<string> => {
  const raw = process.env.ALLOWED_REDIRECT_URIS ?? "";
  if (raw === "") return [];
  return raw.split(",").map((u) => {
    try {
      return new URL(u.trim()).origin;
    } catch {
      return u.trim();
    }
  });
};

const isAllowedRedirectUri = (uri: string): boolean => {
  try {
    const origin = new URL(uri).origin;
    return getAllowedOrigins().includes(origin);
  } catch {
    return false;
  }
};

function stripKnownSubdomain(hostname: string): string {
  if (hostname.startsWith("app.")) {
    return hostname.slice("app.".length);
  }

  if (hostname.startsWith("admin.")) {
    return hostname.slice("admin.".length);
  }

  if (hostname.startsWith("auth.")) {
    return hostname.slice("auth.".length);
  }

  return hostname;
}

export function buildWebsiteHomeUrl(redirectUri: string): string {
  const redirectUrl = new URL(redirectUri);
  const homeUrl = new URL(redirectUrl.origin);
  homeUrl.hostname = stripKnownSubdomain(redirectUrl.hostname);
  homeUrl.pathname = "/";
  homeUrl.search = "";
  homeUrl.hash = "";
  return homeUrl.toString();
}

/**
 * The signed-out login page is the denominator the whole sign-in funnel is measured against, so the
 * visitor identity is minted on the render that shows the form. Nothing here touches the network, so
 * the page keeps its current latency exactly, and a visitor whose identity cannot be written — an
 * unusable signing key, most plainly — still gets the same page: analytics never breaks a sign-in.
 */
function ensureAnalyticsVisitor(c: Context): void {
  try {
    if (readAuthAnalyticsVisitor(c) !== null) {
      return;
    }

    writeAuthAnalyticsVisitor(c, createAuthAnalyticsVisitor(Date.now()));
  } catch (error) {
    logWarning({
      domain: "auth",
      action: "analytics_visitor_cookie_error",
      route: c.req.path,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

app.get("/login", async (c) => {
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const localeHint = c.req.query("locale");

  if (redirectUri === "") {
    return c.text("Missing redirect_uri parameter", 400);
  }

  if (!isAllowedRedirectUri(redirectUri)) {
    return c.text("Invalid redirect_uri", 400);
  }

  const sessionCookie = getCookie(c, "session") ?? "";
  if (sessionCookie !== "") {
    const validation = await validateSessionToken(sessionCookie);
    if (validation.status === "valid") {
      return c.redirect(redirectUri, 302);
    }

    if (validation.status === "error") {
      throw new Error(validation.reason);
    }

    log({ domain: "auth", action: "error", error: validation.reason });
  }

  const websiteHomeUrl = buildWebsiteHomeUrl(redirectUri);
  const locale = resolveLoginPageLocale(localeHint, c.req.header("accept-language"));
  const html = renderLoginPage(redirectUri, websiteHomeUrl, locale);
  ensureAnalyticsVisitor(c);
  // This response now carries a per-visitor identity in a `Set-Cookie`, which makes it a response
  // for exactly one requester. No cache between this origin and that one browser may store it, and
  // that holds whatever does or does not sit in the path today: a stored copy would hand one
  // visitor identity to many people, collapsing the funnel denominator and, once that identity is
  // linked to an account, binding unrelated visitors to one analytics identity. Same rule as the
  // consent page in routes/oauth/authorize.ts, which is `no-store` for the same kind of reason.
  c.header("Cache-Control", "no-store");
  return c.html(html);
});

export default app;
