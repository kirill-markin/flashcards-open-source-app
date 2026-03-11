/**
 * Login page route. Validates redirect_uri origin against ALLOWED_REDIRECT_URIS
 * and serves the HTML login page (English only).
 *
 * The redirect_uri may include a path so the user returns to the page they
 * originally visited after login. Only the origin is validated.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { validateSessionToken } from "../server/browserSession.js";
import { log } from "../server/logger.js";
import { renderLoginPage } from "../templates/login.js";

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

app.get("/login", async (c) => {
  const redirectUri = c.req.query("redirect_uri") ?? "";

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
  const html = renderLoginPage(redirectUri, websiteHomeUrl);
  return c.html(html);
});

export default app;
