import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { getPublicAuthMethods } from "../../server/social/publicMethods.js";
import { parseSocialClient } from "../../server/social/publicContract.js";
import { requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.get("/api/auth-methods", async (c) => {
  try {
    await requireSocialRequest(c, "capabilities");
    return c.json(getPublicAuthMethods(parseSocialClient(c.req.query("client") ?? "web")));
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
