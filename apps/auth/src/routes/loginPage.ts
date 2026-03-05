/**
 * Login page route. Validates redirect_uri origin against ALLOWED_REDIRECT_URIS
 * and serves the HTML login page (English only).
 *
 * The redirect_uri may include a path so the user returns to the page they
 * originally visited after login. Only the origin is validated.
 */
import { Hono } from "hono";
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

app.get("/login", (c) => {
  const redirectUri = c.req.query("redirect_uri") ?? "";

  if (redirectUri === "") {
    return c.text("Missing redirect_uri parameter", 400);
  }

  if (!isAllowedRedirectUri(redirectUri)) {
    return c.text("Invalid redirect_uri", 400);
  }

  const html = renderLoginPage(redirectUri);
  return c.html(html);
});

export default app;
