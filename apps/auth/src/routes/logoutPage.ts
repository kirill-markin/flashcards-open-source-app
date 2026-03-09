/**
 * Browser logout route. Revokes the refresh cookie when present, clears the
 * browser session cookies, and redirects back to the app.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { clearBrowserSessionCookies } from "../server/browserSession.js";
import { type AuthAppEnv, getRequestId } from "../server/apiErrors.js";
import { revokeToken } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

const app = new Hono<AuthAppEnv>();

const getAllowedOrigins = (): ReadonlyArray<string> => {
  const raw = process.env.ALLOWED_REDIRECT_URIS ?? "";
  if (raw === "") {
    return [];
  }

  return raw.split(",").map((value) => {
    try {
      return new URL(value.trim()).origin;
    } catch {
      return value.trim();
    }
  });
};

const isAllowedRedirectUri = (uri: string): boolean => {
  try {
    return getAllowedOrigins().includes(new URL(uri).origin);
  } catch {
    return false;
  }
};

function appendLoggedOutMarker(redirectUri: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("logged_out", "1");
  return url.toString();
}

app.get("/logout", async (c) => {
  const redirectUri = c.req.query("redirect_uri") ?? "";

  if (redirectUri === "") {
    return c.text("Missing redirect_uri parameter", 400);
  }

  if (isAllowedRedirectUri(redirectUri) === false) {
    return c.text("Invalid redirect_uri", 400);
  }

  const refreshToken = getCookie(c, "refresh") ?? "";
  if (refreshToken !== "") {
    try {
      await revokeToken(refreshToken);
    } catch (error) {
      log({
        domain: "auth",
        action: "revoke_token_error",
        requestId: getRequestId(c),
        route: c.req.path,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("Sign out failed. Try again.", 500);
    }
  }

  clearBrowserSessionCookies(c);
  return c.redirect(appendLoggedOutMarker(redirectUri), 302);
});

export default app;
