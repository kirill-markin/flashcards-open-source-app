/**
 * Shared Hono app factory used by both local server (index.ts) and
 * Lambda handler (lambda.ts).
 *
 * basePath: "/" for local dev, "/v1" for Lambda execute-api stage paths.
 * Custom-domain auth traffic arrives without a stage prefix.
 */
import { Hono } from "hono";
import health from "./routes/health.js";
import sendCode from "./routes/sendCode.js";
import verifyCode from "./routes/verifyCode.js";
import loginPage from "./routes/loginPage.js";
import refreshToken from "./routes/refreshToken.js";
import revokeToken from "./routes/revokeToken.js";

function getMountPaths(basePath: string): ReadonlyArray<string> {
  if (basePath === "/v1") {
    return ["/", "/v1"];
  }

  return [basePath];
}

function createMountedApp(basePath: string): Hono {
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

export function createApp(basePath: string): Hono {
  const mountPaths = getMountPaths(basePath);
  if (mountPaths.length === 1) {
    return createMountedApp(mountPaths[0]);
  }

  const app = new Hono();
  for (const mountPath of mountPaths) {
    app.route("/", createMountedApp(mountPath));
  }

  return app;
}
