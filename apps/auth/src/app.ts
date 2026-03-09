/**
 * Shared Hono app factory used by both local server (index.ts) and
 * Lambda handler (lambda.ts).
 *
 * basePath: "/" for local dev, "/v1" for Lambda execute-api stage paths.
 * Custom-domain auth traffic arrives without a stage prefix.
 */
import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import health from "./routes/health.js";
import sendCode from "./routes/sendCode.js";
import verifyCode from "./routes/verifyCode.js";
import loginPage from "./routes/loginPage.js";
import refreshSession from "./routes/refreshSession.js";
import refreshToken from "./routes/refreshToken.js";
import revokeToken from "./routes/revokeToken.js";
import logoutPage from "./routes/logoutPage.js";
import robots from "./routes/robots.js";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "./server/apiErrors.js";
import { log } from "./server/logger.js";

function getMountPaths(basePath: string): ReadonlyArray<string> {
  if (basePath === "/v1") {
    return ["/", "/v1"];
  }

  return [basePath];
}

function getAllowedApiOrigins(): ReadonlyArray<string> {
  const value = process.env.ALLOWED_REDIRECT_URIS;
  if (value === undefined || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
}

function appendVaryHeader(currentValue: string | undefined, value: string): string {
  if (currentValue === undefined || currentValue === "") {
    return value;
  }

  const parts = currentValue.split(",").map((part) => part.trim());
  if (parts.includes(value)) {
    return currentValue;
  }

  return `${currentValue}, ${value}`;
}

function setApiCorsHeaders(c: Context<AuthAppEnv>, origin: string): void {
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "content-type, authorization, x-csrf-token");
  c.header("Vary", appendVaryHeader(c.res.headers.get("Vary") ?? undefined, "Origin"));
}

function createMountedApp(basePath: string): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>().basePath(basePath);
  const allowedApiOrigins = getAllowedApiOrigins();

  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  });

  // Deny cross-origin requests to API endpoints (defense-in-depth).
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      if (!allowedApiOrigins.includes(origin)) {
        return c.json({ error: "Origin is not allowed" }, 403);
      }
      setApiCorsHeaders(c, origin);
    }

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    const secFetchSite = c.req.header("sec-fetch-site");
    // `app.<domain>` refreshes the browser session through `auth.<domain>`,
    // which is cross-origin but still same-site and protected by browser cookies.
    if (
      secFetchSite !== undefined
      && secFetchSite !== "same-origin"
      && secFetchSite !== "same-site"
      && secFetchSite !== "none"
    ) {
      return c.json({ error: "Cross-origin requests not allowed" }, 403);
    }
    await next();
  });

  app.onError((error, c) => {
    const requestId = getRequestId(c);
    log({
      domain: "auth",
      action: "request_error",
      requestId,
      route: c.req.path,
      statusCode: 500,
      code: "INTERNAL_ERROR",
      error: error instanceof Error ? error.message : String(error),
    });

    if (c.req.path.startsWith("/api/")) {
      return jsonAuthError(c, 500, "INTERNAL_ERROR", "Authentication failed. Try again.");
    }

    return c.text(`Request failed. Reference: ${requestId}`, 500);
  });

  app.route("/", health);
  app.route("/", robots);
  app.route("/", sendCode);
  app.route("/", verifyCode);
  app.route("/", loginPage);
  app.route("/", refreshSession);
  app.route("/", refreshToken);
  app.route("/", revokeToken);
  app.route("/", logoutPage);

  return app;
}

export function createApp(basePath: string): Hono<AuthAppEnv> {
  const mountPaths = getMountPaths(basePath);
  if (mountPaths.length === 1) {
    return createMountedApp(mountPaths[0]);
  }

  const app = new Hono<AuthAppEnv>();
  for (const mountPath of mountPaths) {
    app.route("/", createMountedApp(mountPath));
  }

  return app;
}
