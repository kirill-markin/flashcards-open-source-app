import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { getOidcUserInfo } from "../../server/oauth/oauthStore.js";

const app = new Hono<AuthAppEnv>();

app.on(["GET", "POST"], "/userinfo", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  const authorization = c.req.header("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const userInfo = match === null ? null : await getOidcUserInfo(match[1], Date.now());
  if (userInfo === null) {
    c.header("WWW-Authenticate", 'Bearer error="invalid_token"');
    return c.json({ error: "invalid_token", error_description: "A valid OAuth access token is required." }, 401);
  }
  if (userInfo === "insufficient_scope") {
    c.header("WWW-Authenticate", 'Bearer error="insufficient_scope", scope="openid"');
    return c.json({ error: "insufficient_scope", error_description: "The openid scope is required." }, 403);
  }
  return c.json(userInfo);
});

export default app;
