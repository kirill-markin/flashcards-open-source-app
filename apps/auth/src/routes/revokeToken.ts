/**
 * Token revocation endpoint for mobile clients (logout).
 * Accepts a refresh token and revokes it via Cognito.
 */
import { Hono } from "hono";
import { revokeToken } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";

const app = new Hono();

app.post("/api/revoke-token", async (c) => {
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
    await revokeToken(refreshToken);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ domain: "auth", action: "revoke_token_error", error: message });
    return c.json({ error: "Token revocation failed" }, 500);
  }
});

export default app;
