import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { clearBrowserSessionCookies, setBrowserSessionCookies } from "../server/browserSession.js";
import { refreshTokens } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

const app = new Hono();

app.post("/api/refresh-session", async (c) => {
  const refreshToken = getCookie(c, "refresh") ?? "";
  if (refreshToken === "") {
    clearBrowserSessionCookies(c);
    return c.json({ error: "Refresh token is missing" }, 401);
  }

  try {
    const tokens = await refreshTokens(refreshToken);
    setBrowserSessionCookies(c, tokens.idToken, refreshToken);
    return c.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log({ domain: "auth", action: "refresh_token_error", error: message });
    clearBrowserSessionCookies(c);
    return c.json({ error: "Session refresh failed — please sign in again" }, 401);
  }
});

export default app;
