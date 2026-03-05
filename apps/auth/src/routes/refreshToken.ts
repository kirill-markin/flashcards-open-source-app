/**
 * Token refresh endpoint for mobile clients.
 * Accepts a refresh token, calls Cognito REFRESH_TOKEN_AUTH,
 * and returns new id/access tokens.
 */
import { Hono } from "hono";
import { refreshTokens } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

const app = new Hono();

app.post("/api/refresh-token", async (c) => {
  let body: { refreshToken?: string };
  try {
    body = await c.req.json<{ refreshToken?: string }>();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";

  if (refreshToken === "") {
    return c.json({ error: "refreshToken is required" }, 400);
  }

  try {
    const tokens = await refreshTokens(refreshToken);
    return c.json({
      ok: true,
      idToken: tokens.idToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ domain: "auth", action: "refresh_token_error", error: message });
    return c.json({ error: "Token refresh failed — please sign in again" }, 401);
  }
});

export default app;
