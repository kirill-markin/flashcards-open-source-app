/**
 * Token refresh endpoint for mobile clients.
 * Accepts a refresh token, calls Cognito REFRESH_TOKEN_AUTH,
 * and returns new id/access tokens.
 */
import { Hono } from "hono";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { isTerminalRefreshFailure, refreshTokens } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

type RefreshTokenDependencies = Readonly<{
  refreshTokens: (refreshToken: string) => Promise<Awaited<ReturnType<typeof refreshTokens>>>;
}>;

export function createRefreshTokenApp(dependencies: RefreshTokenDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/refresh-token", async (c) => {
    let body: { refreshToken?: string };
    try {
      body = await c.req.json<{ refreshToken?: string }>();
    } catch {
      return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid request.");
    }

    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";

    if (refreshToken === "") {
      return jsonAuthError(c, 401, "REFRESH_TOKEN_MISSING", "Sign in again.");
    }

    const requestId = getRequestId(c);
    try {
      const tokens = await dependencies.refreshTokens(refreshToken);
      return c.json({
        ok: true,
        idToken: tokens.idToken,
        expiresIn: tokens.expiresIn,
      });
    } catch (error) {
      if (isTerminalRefreshFailure(error)) {
        const message = error instanceof Error ? error.message : String(error);
        log({
          domain: "auth",
          action: "refresh_token_error",
          requestId,
          route: c.req.path,
          statusCode: 401,
          code: "REFRESH_TOKEN_FAILED",
          error: message,
        });
        return jsonAuthError(c, 401, "REFRESH_TOKEN_FAILED", "Sign in again.");
      }

      throw error;
    }
  });

  return app;
}

export default createRefreshTokenApp({
  refreshTokens,
});
