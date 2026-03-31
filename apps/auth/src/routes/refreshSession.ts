import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { clearBrowserSessionCookies, setBrowserSessionCookies } from "../server/browserSession.js";
import { refreshTokens } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

const app = new Hono<AuthAppEnv>();

app.post("/api/refresh-session", async (c) => {
  const requestId = getRequestId(c);
  const refreshToken = getCookie(c, "refresh") ?? "";
  if (refreshToken === "") {
    log({
      domain: "auth",
      action: "refresh_session_missing_cookie",
      requestId,
      route: c.req.path,
      statusCode: 401,
      code: "REFRESH_TOKEN_MISSING",
      reasonCategory: "missing_refresh_cookie",
    });
    clearBrowserSessionCookies(c);
    return jsonAuthError(c, 401, "REFRESH_TOKEN_MISSING", "Sign in again.");
  }

  try {
    const tokens = await refreshTokens(refreshToken);
    setBrowserSessionCookies(c, tokens.idToken, refreshToken);
    log({
      domain: "auth",
      action: "refresh_session",
      requestId,
      route: c.req.path,
      statusCode: 200,
    });
    return c.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log({
      domain: "auth",
      action: "refresh_session_error",
      requestId,
      route: c.req.path,
      statusCode: 401,
      code: "REFRESH_TOKEN_FAILED",
      reasonCategory: "cognito_refresh_failed",
      error: message,
    });
    clearBrowserSessionCookies(c);
    return jsonAuthError(c, 401, "REFRESH_TOKEN_FAILED", "Sign in again.");
  }
});

export default app;
