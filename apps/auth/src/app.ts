/**
 * Shared Hono app factory used by both local server (index.ts) and
 * Lambda handler (lambda.ts).
 *
 * basePath: "/" for local dev, "/v1" for Lambda execute-api stage paths.
 * Custom-domain auth traffic arrives without a stage prefix.
 */
import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import health from "./routes/health.js";
import agentSendCode from "./routes/agent/agentSendCode.js";
import agentVerifyCode from "./routes/agent/agentVerifyCode.js";
import sendCode from "./routes/browser/sendCode.js";
import verifyCode from "./routes/browser/verifyCode.js";
import loginPage from "./routes/browser/loginPage.js";
import refreshSession from "./routes/browser/refreshSession.js";
import refreshToken from "./routes/browser/refreshToken.js";
import revokeToken from "./routes/browser/revokeToken.js";
import logoutPage from "./routes/browser/logoutPage.js";
import logoutLocalPage from "./routes/browser/logoutLocalPage.js";
import oauthMetadata from "./routes/oauth/metadata.js";
import oauthRegister from "./routes/oauth/register.js";
import oauthToken from "./routes/oauth/token.js";
import oauthAuthorize from "./routes/oauth/authorize.js";
import robots from "./routes/robots.js";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "./server/apiErrors.js";
import { getDemoEmailAccessConfig } from "./server/demoEmailAccess.js";
import { createAgentErrorEnvelope } from "./server/agent/agentEnvelope.js";
import { isTransientDatabaseError } from "./server/databaseErrors.js";
import { log } from "./server/logger.js";

const apiCorsAllowHeaders = [
  "content-type",
  "authorization",
  "x-csrf-token",
  "sentry-trace",
  "baggage",
] as const;

const apiCorsExposeHeaders = [
  "retry-after",
  "x-request-id",
] as const;

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
  c.header("Access-Control-Allow-Headers", apiCorsAllowHeaders.join(", "));
  c.header("Access-Control-Expose-Headers", apiCorsExposeHeaders.join(", "));
  c.header("Vary", appendVaryHeader(c.res.headers.get("Vary") ?? undefined, "Origin"));
}

type ApiRouteKind = "agent" | "api" | "non-api";

function stripApiStagePrefix(path: string): string {
  if (path === "/v1") {
    return "/";
  }

  if (path.startsWith("/v1/")) {
    return path.slice(3);
  }

  return path;
}

function getApiRouteKind(path: string): ApiRouteKind {
  const routePath = stripApiStagePrefix(path);
  if (routePath === "/api/agent" || routePath.startsWith("/api/agent/")) {
    return "agent";
  }

  if (routePath === "/api" || routePath.startsWith("/api/")) {
    return "api";
  }

  return "non-api";
}

// Public OAuth Authorization Server endpoints (RFC 8414 metadata, RFC 7591 DCR,
// token). These are unauthenticated and credential-free, so browser-hosted MCP
// clients reach them with a wildcard-origin CORS policy (NO credentials),
// distinct from the cookie-bearing /api/* policy above.
const oauthPublicPaths: ReadonlyArray<string> = [
  "/.well-known/oauth-authorization-server",
  "/register",
  "/token",
];

function isOAuthPublicPath(path: string): boolean {
  return oauthPublicPaths.includes(stripApiStagePrefix(path));
}

function createMountedApp(basePath: string): Hono<AuthAppEnv> {
  getDemoEmailAccessConfig();
  const app = new Hono<AuthAppEnv>().basePath(basePath);
  const allowedApiOrigins = getAllowedApiOrigins();

  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  });

  // Public, credential-free CORS for the OAuth Authorization Server endpoints so
  // browser-hosted MCP clients can run discovery -> DCR -> token exchange.
  app.use("*", async (c, next) => {
    if (!isOAuthPublicPath(c.req.path)) {
      return next();
    }

    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "content-type");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });

  // Deny cross-origin requests to cookie-authenticated, state-changing
  // endpoints (defense-in-depth). Shared by /api/* and the OAuth consent POST.
  const denyCrossOrigin: MiddlewareHandler<AuthAppEnv> = async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      const requestOrigin = new URL(c.req.url).origin;
      const isSameOriginRequest = origin === requestOrigin;
      if (!isSameOriginRequest && !allowedApiOrigins.includes(origin)) {
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
  };

  app.use("/api/*", denyCrossOrigin);
  // The OAuth consent POST is cookie-authenticated and state-changing but lives
  // outside /api/*, so it gets the same cross-origin guard explicitly.
  app.use("/authorize/consent", denyCrossOrigin);

  app.onError((error, c) => {
    const requestId = getRequestId(c);
    const routeKind = getApiRouteKind(c.req.path);
    if (isTransientDatabaseError(error)) {
      const statusCode = 503;
      const code = "SERVICE_UNAVAILABLE";
      const message = "Service is temporarily unavailable. Retry shortly.";
      log({
        domain: "auth",
        action: "request_error",
        requestId,
        route: c.req.path,
        statusCode,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
      c.header("Retry-After", "1");
      c.header("Access-Control-Expose-Headers", apiCorsExposeHeaders.join(", "));

      if (routeKind === "agent") {
        return c.json(
          createAgentErrorEnvelope(
            c.req.url,
            code,
            message,
            "Retry the same action shortly.",
          ),
          statusCode,
        );
      }

      if (routeKind === "api") {
        return c.json({
          error: message,
          requestId,
          code,
        }, statusCode);
      }

      return c.text(`Request failed. Reference: ${requestId}`, statusCode);
    }

    log({
      domain: "auth",
      action: "request_error",
      requestId,
      route: c.req.path,
      statusCode: 500,
      code: "INTERNAL_ERROR",
      error: error instanceof Error ? error.message : String(error),
    });

    if (routeKind === "agent" || routeKind === "api") {
      if (routeKind === "agent") {
        return c.json(
          createAgentErrorEnvelope(
            c.req.url,
            "INTERNAL_ERROR",
            "Agent authentication request failed. Try again.",
            "Retry the same action. If the issue persists, restart from GET /v1/agent on the API host and follow the returned actions.",
          ),
          500,
        );
      }
      return jsonAuthError(c, 500, "INTERNAL_ERROR", "Authentication failed. Try again.");
    }

    return c.text(`Request failed. Reference: ${requestId}`, 500);
  });

  app.route("/", health);
  app.route("/", robots);
  app.route("/", agentSendCode);
  app.route("/", agentVerifyCode);
  app.route("/", sendCode);
  app.route("/", verifyCode);
  app.route("/", loginPage);
  app.route("/", refreshSession);
  app.route("/", refreshToken);
  app.route("/", revokeToken);
  app.route("/", logoutPage);
  app.route("/", logoutLocalPage);
  app.route("/", oauthMetadata);
  app.route("/", oauthRegister);
  app.route("/", oauthToken);
  app.route("/", oauthAuthorize);

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
