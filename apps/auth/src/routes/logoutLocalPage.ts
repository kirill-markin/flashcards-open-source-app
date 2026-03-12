/**
 * Browser logout-complete route. Clears the browser session cookies without
 * calling Cognito revocation, then redirects back to the app with markers
 * that the web client can use to present the account-deleted completion state.
 */
import { Hono } from "hono";
import { clearBrowserSessionCookies } from "../server/browserSession.js";
import { type AuthAppEnv } from "../server/apiErrors.js";

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

function appendAccountDeletedMarkers(redirectUri: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("logged_out", "1");
  url.searchParams.set("account_deleted", "1");
  return url.toString();
}

app.get("/logout-local", async (c) => {
  const redirectUri = c.req.query("redirect_uri") ?? "";

  if (redirectUri === "") {
    return c.text("Missing redirect_uri parameter", 400);
  }

  if (isAllowedRedirectUri(redirectUri) === false) {
    return c.text("Invalid redirect_uri", 400);
  }

  clearBrowserSessionCookies(c);
  return c.redirect(appendAccountDeletedMarkers(redirectUri), 302);
});

export default app;
