/**
 * Shared Hono app factory used by both local server (index.ts) and
 * Lambda handler (lambda.ts).
 *
 * basePath: "/" for local dev, "/auth" for Lambda behind API Gateway
 * (API Gateway routes /auth/{proxy+} to this Lambda, so paths arrive
 * as /auth/health, /auth/api/send-code, etc.)
 */
import { Hono } from "hono";
import health from "./routes/health.js";
import sendCode from "./routes/sendCode.js";
import verifyCode from "./routes/verifyCode.js";
import loginPage from "./routes/loginPage.js";
import refreshToken from "./routes/refreshToken.js";
import revokeToken from "./routes/revokeToken.js";

export function createApp(basePath: string): Hono {
  const app = new Hono().basePath(basePath);

  // Deny cross-origin requests to API endpoints (defense-in-depth).
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite !== undefined && secFetchSite !== "same-origin" && secFetchSite !== "none") {
      return c.json({ error: "Cross-origin requests not allowed" }, 403);
    }
    await next();
  });

  app.route("/", health);
  app.route("/", sendCode);
  app.route("/", verifyCode);
  app.route("/", loginPage);
  app.route("/", refreshToken);
  app.route("/", revokeToken);

  return app;
}
