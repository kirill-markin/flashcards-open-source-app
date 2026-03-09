/**
 * Token revocation endpoint for mobile clients (logout).
 * Accepts a refresh token and revokes it via Cognito.
 */
import { Hono } from "hono";
import { clearBrowserSessionCookies } from "../server/browserSession.js";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { revokeToken } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

const app = new Hono<AuthAppEnv>();

app.post("/api/revoke-token", async (c) => {
  let body: { refreshToken?: string };
  try {
    body = await c.req.json<{ refreshToken?: string }>();
  } catch {
    return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid request.");
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";

  if (refreshToken === "") {
    return jsonAuthError(c, 400, "REVOKE_TOKEN_MISSING", "Sign in again.");
  }

  const requestId = getRequestId(c);
  try {
    await revokeToken(refreshToken);
    clearBrowserSessionCookies(c);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      domain: "auth",
      action: "revoke_token_error",
      requestId,
      route: c.req.path,
      statusCode: 500,
      code: "REVOKE_TOKEN_FAILED",
      error: message,
    });
    return jsonAuthError(c, 500, "REVOKE_TOKEN_FAILED", "Sign out failed. Try again.");
  }
});

export default app;
