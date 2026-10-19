/**
 * Token revocation endpoint for mobile clients (logout).
 * Accepts a refresh token and revokes it via Cognito.
 */
import { Hono } from "hono";
import { clearAuthAnalyticsGuestSession } from "../../server/analytics/visitorSession.js";
import { clearBrowserSessionCookies } from "../../server/browserSession.js";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../../server/apiErrors.js";
import { revokeToken } from "../../server/cognito/cognitoAuth.js";
import { isCognitoProviderOutage } from "../../server/cognito/cognitoErrors.js";
import { getCognitoOutageLogFields, reportCognitoProviderOutage } from "../../server/cognito/cognitoOutageReport.js";
import { log } from "../../server/logger.js";

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
    // Retired along with the session, under the rule in `clearAuthAnalyticsGuestSession`'s
    // docstring. A caller holding neither cookie is unaffected by either clear.
    clearAuthAnalyticsGuestSession(c);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cognitoProviderOutage = isCognitoProviderOutage(err) ? err : null;
    const statusCode = cognitoProviderOutage === null ? 500 : 503;
    log({
      domain: "auth",
      action: "revoke_token_error",
      requestId,
      route: c.req.path,
      statusCode,
      code: "REVOKE_TOKEN_FAILED",
      error: message,
      ...(cognitoProviderOutage === null ? {} : getCognitoOutageLogFields(cognitoProviderOutage)),
    });
    if (cognitoProviderOutage !== null) {
      reportCognitoProviderOutage(c, cognitoProviderOutage, "REVOKE_TOKEN_FAILED");
      c.header("Retry-After", "1");
    }
    return jsonAuthError(c, statusCode, "REVOKE_TOKEN_FAILED", "Sign out failed. Try again.");
  }
});

export default app;
