import accountConnection from "./routes/social/accountConnection.js";
import authFact from "./routes/browser/authFact.js";
import { randomUUID } from "node:crypto";
import { PrincipalSessionError } from "./server/social/principalSessions.js";
import { IssuedSessionValidationError } from "./server/browserSession.js";
import * as Sentry from "@sentry/aws-serverless";
import { type Context, Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import health from "./routes/health.js";
import authMethods from "./routes/social/authMethods.js";
import loginMethods from "./routes/social/loginMethods.js";
import linkMethod from "./routes/social/linkMethod.js";
import unlinkMethod from "./routes/social/unlinkMethod.js";
import currentEmailReauth from "./routes/social/currentEmailReauth.js";
import socialAttempt from "./routes/social/attempt.js";
import socialComplete from "./routes/social/complete.js";
import socialBrowserStart from "./routes/social/browserStart.js";
import socialBrowserCallback from "./routes/social/browserCallback.js";
import appleNotifications from "./routes/social/appleNotifications.js";
import agentSendCode from "./routes/agent/agentSendCode.js";
import agentVerifyCode from "./routes/agent/agentVerifyCode.js";
import sendCode from "./routes/browser/sendCode.js";
import verifyCode from "./routes/browser/verifyCode.js";
import loginPage from "./routes/browser/loginPage.js";
import browserHints from "./routes/browser/browserHints.js";
import refreshSession from "./routes/browser/refreshSession.js";
import refreshToken from "./routes/browser/refreshToken.js";
import revokeToken from "./routes/browser/revokeToken.js";
import logoutPage from "./routes/browser/logoutPage.js";
import logoutLocalPage from "./routes/browser/logoutLocalPage.js";
import oauthUserInfo from "./routes/oauth/userinfo.js";
import oauthMetadata from "./routes/oauth/metadata.js";
import oauthRegister from "./routes/oauth/register.js";
import oauthToken from "./routes/oauth/token.js";
import oauthAuthorize from "./routes/oauth/authorize.js";
import robots from "./routes/robots.js";
import {
  type AuthAppEnv,
  getRequestLogger,
  getRequestId,
  getTraceId,
  jsonAuthError,
} from "./server/apiErrors.js";
import { getAppleSignInConfig, getGoogleSignInConfig } from "./server/social/config.js";
import { getDemoEmailAccessConfig } from "./server/demoEmailAccess.js";
import { createAgentErrorEnvelope } from "./server/agent/agentEnvelope.js";
import { getDatabaseErrorSqlState, isTransientDatabaseError } from "./server/databaseErrors.js";
import { isCognitoProviderOutage } from "./server/cognito/cognitoErrors.js";
import { getCognitoOutageLogFields, reportCognitoProviderOutage } from "./server/cognito/cognitoOutageReport.js";
import { log } from "./server/logger.js";
import { continueAuthTrace } from "./server/sentry.js";

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

const oauthPublicPaths: ReadonlyArray<string> = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
  "/.well-known/jwks.json",
  "/userinfo",
  "/register",
  "/token",
];

function isOAuthPublicPath(path: string): boolean {
  return oauthPublicPaths.includes(stripApiStagePrefix(path));
}

export function registerAuthErrorHandler(app: Hono<AuthAppEnv>): void {
  app.onError((error, c) => {
    const requestId = getRequestId(c);
    const traceId = getTraceId(c);
    const logger = getRequestLogger(c);
    const routeKind = getApiRouteKind(c.req.path);
    const socialCompletion = ["/api/social/complete", "/api/social/browser/complete",
      "/api/social/google/callback", "/api/social/apple/callback", "/api/social/apple/continue"].includes(stripApiStagePrefix(c.req.path));
    if (error instanceof PrincipalSessionError) {
      if (error.statusCode === 503) c.header("Retry-After", "1");
      if (routeKind === "agent") {
        return c.json(createAgentErrorEnvelope(c.req.url, error.code, error.message,
          error.statusCode === 410 ? "This account was deleted. Do not retry."
            : "Start a fresh sign-in after pending session cleanup completes."), error.statusCode);
      }
      return jsonAuthError(c, error.statusCode, error.code, error.message);
    }
    if (error instanceof IssuedSessionValidationError) {
      return jsonAuthError(c, 503, socialCompletion ? "AUTH_ATTEMPT_RESTART_REQUIRED" : "SERVICE_UNAVAILABLE",
        socialCompletion
          ? "Session validation could not complete after authentication. Start a new provider sign-in; the previous proof was consumed."
          : "Session validation could not complete after Cognito returned tokens. Retry refreshing shortly.");
    }
    if (getDatabaseErrorSqlState(error) === "P0A01") {
      const code = "ACCOUNT_SCOPE_CHANGED";
      const message = "Account ownership changed or is busy. Reload the account and retry the request.";
      logger({ domain: "auth", action: "request_error", requestId, traceId, route: c.req.path,
        statusCode: 409, code, error: error.message });
      if (routeKind === "agent") {
        return c.json(createAgentErrorEnvelope(c.req.url, code, message, "Reload the account and retry."), 409);
      }
      return jsonAuthError(c, 409, code, message);
    }
    const cognitoProviderOutage = isCognitoProviderOutage(error) ? error : null;
    if (cognitoProviderOutage !== null || isTransientDatabaseError(error)) {
      const statusCode = 503;
      const code = socialCompletion ? "AUTH_ATTEMPT_RESTART_REQUIRED" : "SERVICE_UNAVAILABLE";
      const message = socialCompletion
        ? "Sign-in could not complete. Start a new provider sign-in; the previous proof may have been consumed."
        : "Service is temporarily unavailable. Retry shortly.";
      logger({
        domain: "auth",
        action: "request_error",
        requestId,
        traceId,
        route: c.req.path,
        statusCode,
        code,
        error: error instanceof Error ? error.message : String(error),
        ...(cognitoProviderOutage === null ? {} : getCognitoOutageLogFields(cognitoProviderOutage)),
      });
      if (cognitoProviderOutage !== null) reportCognitoProviderOutage(c, cognitoProviderOutage, code);
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

    logger({
      domain: "auth",
      action: "request_error",
      requestId,
      traceId,
      route: c.req.path,
      statusCode: 500,
      code: "INTERNAL_ERROR",
      error: error instanceof Error ? error.message : String(error),
    });

    // Hono's onError swallows the error (returns a 500 response), so
    // Sentry.wrapHandler never sees it. Capture explicitly here.
    Sentry.captureException(error, {
      tags: { service: "auth", route: c.req.path, code: "INTERNAL_ERROR" },
      extra: { requestId },
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
      return socialCompletion
        ? jsonAuthError(c, 500, "AUTH_ATTEMPT_RESTART_REQUIRED", "Sign-in could not complete. Start a new provider sign-in; the previous proof may have been consumed.")
        : jsonAuthError(c, 500, "INTERNAL_ERROR", "Authentication failed. Try again.");
    }

    return c.text(`Request failed. Reference: ${requestId}`, 500);
  });
}

function createMountedApp(basePath: string): Hono<AuthAppEnv> {
  getDemoEmailAccessConfig();
  getAppleSignInConfig();
  getGoogleSignInConfig();
  const app = new Hono<AuthAppEnv>().basePath(basePath);
  const allowedApiOrigins = getAllowedApiOrigins();

  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.set("logger", log);
    c.header("X-Request-Id", requestId);
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  });

  app.use("*", async (c, next) => {
    const sentryTrace = c.req.header("sentry-trace") ?? null;
    const baggage = c.req.header("baggage") ?? null;
    await continueAuthTrace(sentryTrace, baggage, async (traceId) => {
      c.set("traceId", traceId);
      await next();
    });
  });

  app.use("*", async (c, next) => {
    if (!isOAuthPublicPath(c.req.path)) {
      return next();
    }

    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "content-type, authorization");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });

  // Deny cross-origin requests to cookie-authenticated, state-changing
  // endpoints (defense-in-depth). Shared by /api/* and the OAuth consent POST.
  const denyCrossOrigin: MiddlewareHandler<AuthAppEnv> = async (c, next) => {
    const routePath = stripApiStagePrefix(c.req.path);
    const providerCallback = (c.req.method === "GET" && routePath === "/api/social/google/callback")
      || (c.req.method === "POST" && routePath === "/api/social/apple/callback"
        && c.req.header("content-type")?.split(";")[0].trim().toLowerCase() === "application/x-www-form-urlencoded"
        && (c.req.header("origin") === undefined || c.req.header("origin") === "https://appleid.apple.com"));
    // Provider navigations have a one-use state and host-only callback cookie, never a CORS grant.
    if (providerCallback) return next();
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
    const providerStartNavigation = secFetchSite === "cross-site"
      && c.req.method === "GET"
      && (routePath === "/api/social/google/start" || routePath === "/api/social/apple/start"
        || routePath === "/api/account/connection/provider-start")
      && c.req.header("sec-fetch-mode") === "navigate"
      && c.req.header("sec-fetch-dest") === "document";
    // `app.<domain>` refreshes the browser session through `auth.<domain>`,
    // which is cross-origin but still same-site and protected by browser cookies.
    if (
      secFetchSite !== undefined
      && secFetchSite !== "same-origin"
      && secFetchSite !== "same-site"
      && secFetchSite !== "none"
      && !providerStartNavigation
    ) {
      return c.json({ error: "Cross-origin requests not allowed" }, 403);
    }
    await next();
  };

  app.use("/api/*", denyCrossOrigin);
  // The OAuth consent POST is cookie-authenticated and state-changing but lives
  // outside /api/*, so it gets the same cross-origin guard explicitly.
  app.use("/authorize/consent", denyCrossOrigin);

  registerAuthErrorHandler(app);

  app.route("/", health);
  app.route("/", authMethods);
  app.route("/", loginMethods);
  app.route("/", linkMethod);
  app.route("/", unlinkMethod);
  app.route("/", currentEmailReauth);
  app.route("/", accountConnection);
  app.route("/", socialAttempt);
  app.route("/", socialComplete);
  app.route("/", socialBrowserStart);
  app.route("/", socialBrowserCallback);
  app.route("/", appleNotifications);
  app.route("/", robots);
  app.route("/", agentSendCode);
  app.route("/", agentVerifyCode);
  app.route("/", sendCode);
  app.route("/", verifyCode);
  app.route("/", loginPage);
  app.route("/", authFact);
  app.route("/", browserHints);
  app.route("/", refreshSession);
  app.route("/", refreshToken);
  app.route("/", revokeToken);
  app.route("/", logoutPage);
  app.route("/", logoutLocalPage);
  app.route("/", oauthMetadata);
  app.route("/", oauthUserInfo);
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
