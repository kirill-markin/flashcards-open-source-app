import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerAuthErrorHandler } from "./app.js";
import { createRefreshSessionApp } from "./routes/browser/refreshSession.js";
import { createRefreshTokenApp } from "./routes/browser/refreshToken.js";
import type { AuthAppEnv } from "./server/apiErrors.js";
import { createCognitoTypedError, type CognitoTypedError } from "./server/cognito/cognitoErrors.js";
import { type AuthLogEvent, type AuthLogger, log } from "./server/logger.js";
import { continueAuthTrace } from "./server/sentry.js";

type RefreshResult = Readonly<{
  idToken: string;
  accessToken: string;
  expiresIn: number;
}>;

function createRefreshResult(): RefreshResult {
  return {
    idToken: "id-token",
    accessToken: "access-token",
    expiresIn: 3600,
  };
}

function createTestApp(routeApp: Hono<AuthAppEnv>, logger: AuthLogger): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("logger", logger);
    const sentryTrace = context.req.header("sentry-trace") ?? null;
    const baggage = context.req.header("baggage") ?? null;
    await continueAuthTrace(sentryTrace, baggage, async (traceId) => {
      context.set("traceId", traceId);
      await next();
    });
  });
  app.route("/", routeApp);
  return app;
}

function createTerminalRefreshFailure(): CognitoTypedError {
  return createCognitoTypedError({
    operation: "InitiateAuth",
    providerStatusCode: 400,
    cognitoType: "NotAuthorizedException",
    reasonCode: null,
    message: "Refresh token is invalid",
  });
}

function createNonTerminalRefreshFailure(): CognitoTypedError {
  return createCognitoTypedError({
    operation: "InitiateAuth",
    providerStatusCode: 500,
    cognitoType: "InternalErrorException",
    reasonCode: null,
    message: "Cognito internal error",
  });
}

function getSetCookieValues(response: Response): ReadonlyArray<string> {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
}

test("refresh-session returns 401 and clears cookies when refresh cookie is missing", async () => {
  let clearCookieCallCount = 0;
  const events: Array<AuthLogEvent> = [];
  const logger: AuthLogger = (event) => events.push(event);
  const app = createTestApp(createRefreshSessionApp({
    refreshTokens: async () => createRefreshResult(),
    setBrowserSessionCookies: () => {
      throw new Error("setBrowserSessionCookies must not be called");
    },
    clearBrowserSessionCookies: (context) => {
      clearCookieCallCount += 1;
      context.header("Set-Cookie", "session=; Max-Age=0", { append: true });
      context.header("Set-Cookie", "refresh=; Max-Age=0", { append: true });
      context.header("Set-Cookie", "logged_in=; Max-Age=0", { append: true });
    },
  }), logger);

  const response = await app.request("http://localhost/api/refresh-session", { method: "POST" });
  const payload = await response.json() as Readonly<{ code: string }>;

  assert.equal(response.status, 401);
  assert.equal(payload.code, "REFRESH_TOKEN_MISSING");
  assert.equal(clearCookieCallCount, 1);
  assert.equal(getSetCookieValues(response).length, 3);
  assert.equal(events.length, 2);
  assert.equal(events[0].action, "refresh_session_missing_cookie");
  assert.equal(events[0].traceId, null);
  assert.equal(events[1].action, "request_error");
  assert.equal(events[1].traceId, null);
});

test("refresh-session logs the incoming Sentry trace ID on success", async () => {
  const traceId = "4c79f60c11214eb38604f4ae0781bfb2";
  const events: Array<AuthLogEvent> = [];
  const logger: AuthLogger = (event) => events.push(event);
  const app = createTestApp(createRefreshSessionApp({
    refreshTokens: async () => createRefreshResult(),
    setBrowserSessionCookies: () => undefined,
    clearBrowserSessionCookies: () => {
      throw new Error("clearBrowserSessionCookies must not be called");
    },
  }), logger);

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      cookie: "refresh=refresh-token",
      "sentry-trace": `${traceId}-0123456789abcdef-1`,
      baggage: "sentry-release=%E0%A4%A-secret-release-value",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(events, [{
    domain: "auth",
    action: "refresh_session",
    requestId: "request-1",
    traceId,
    route: "/api/refresh-session",
    statusCode: 200,
  }]);
  assert.equal(JSON.stringify(events).includes("secret-release-value"), false);
});

test("refresh-session ignores invalid Sentry traces on success", async () => {
  const invalidSentryTraces = [
    "malformed-trace-value",
    `${"0".repeat(32)}-0123456789abcdef-1`,
    `4c79f60c11214eb38604f4ae0781bfb2-${"0".repeat(16)}-1`,
  ] as const;

  for (const sentryTrace of invalidSentryTraces) {
    const events: Array<AuthLogEvent> = [];
    const logger: AuthLogger = (event) => events.push(event);
    const app = createTestApp(createRefreshSessionApp({
      refreshTokens: async () => createRefreshResult(),
      setBrowserSessionCookies: () => undefined,
      clearBrowserSessionCookies: () => {
        throw new Error("clearBrowserSessionCookies must not be called");
      },
    }), logger);

    const response = await app.request("http://localhost/api/refresh-session", {
      method: "POST",
      headers: {
        cookie: "refresh=refresh-token",
        "sentry-trace": sentryTrace,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "refresh_session");
    assert.equal(events[0].traceId, null);
    assert.equal(JSON.stringify(events).includes(sentryTrace), false);
  }
});

test("refresh-session returns 401 and clears cookies for terminal refresh failures", async () => {
  let clearCookieCallCount = 0;
  const traceId = "4c79f60c11214eb38604f4ae0781bfb2";
  const events: Array<AuthLogEvent> = [];
  const logger: AuthLogger = (event) => events.push(event);
  const app = createTestApp(createRefreshSessionApp({
    refreshTokens: async () => Promise.reject(createTerminalRefreshFailure()),
    setBrowserSessionCookies: () => {
      throw new Error("setBrowserSessionCookies must not be called");
    },
    clearBrowserSessionCookies: (context) => {
      clearCookieCallCount += 1;
      context.header("Set-Cookie", "session=; Max-Age=0", { append: true });
      context.header("Set-Cookie", "refresh=; Max-Age=0", { append: true });
      context.header("Set-Cookie", "logged_in=; Max-Age=0", { append: true });
    },
  }), logger);

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      cookie: "refresh=refresh-token",
      "sentry-trace": `${traceId}-0123456789abcdef-1`,
      baggage: "sentry-release=secret-release-value",
    },
  });
  const payload = await response.json() as Readonly<{ code: string }>;

  assert.equal(response.status, 401);
  assert.equal(payload.code, "REFRESH_TOKEN_FAILED");
  assert.equal(clearCookieCallCount, 1);
  assert.equal(getSetCookieValues(response).length, 3);
  assert.equal(events.length, 2);
  assert.equal(events[0].action, "refresh_session_error");
  assert.equal(events[0].traceId, traceId);
  assert.equal(events[1].action, "request_error");
  assert.equal(events[1].traceId, traceId);
  assert.equal(JSON.stringify(events).includes(`${traceId}-0123456789abcdef-1`), false);
  assert.equal(JSON.stringify(events).includes("secret-release-value"), false);
});

test("refresh-session bubbles non-terminal refresh failures as 500 without clearing cookies", async () => {
  let clearCookieCallCount = 0;
  const traceId = "4c79f60c11214eb38604f4ae0781bfb2";
  const events: Array<AuthLogEvent> = [];
  const logger: AuthLogger = (event) => events.push(event);
  const app = createTestApp(createRefreshSessionApp({
    refreshTokens: async () => Promise.reject(createNonTerminalRefreshFailure()),
    setBrowserSessionCookies: () => {
      throw new Error("setBrowserSessionCookies must not be called");
    },
    clearBrowserSessionCookies: () => {
      clearCookieCallCount += 1;
    },
  }), logger);
  registerAuthErrorHandler(app);

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      cookie: "refresh=refresh-token",
      "sentry-trace": `${traceId}-0123456789abcdef-1`,
      baggage: "sentry-release=secret-release-value",
    },
  });

  assert.equal(response.status, 500);
  assert.equal(clearCookieCallCount, 0);
  assert.equal(getSetCookieValues(response).length, 0);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    domain: "auth",
    action: "request_error",
    requestId: "request-1",
    traceId,
    route: "/api/refresh-session",
    statusCode: 500,
    code: "INTERNAL_ERROR",
    error: "Cognito internal error",
  });
  assert.deepEqual(events[1], {
    domain: "auth",
    action: "request_error",
    requestId: "request-1",
    traceId,
    route: "/api/refresh-session",
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
  assert.equal(JSON.stringify(events).includes(`${traceId}-0123456789abcdef-1`), false);
  assert.equal(JSON.stringify(events).includes("secret-release-value"), false);
});

test("refresh-token returns 401 for terminal refresh failures", async () => {
  const app = createTestApp(createRefreshTokenApp({
    refreshTokens: async () => Promise.reject(createTerminalRefreshFailure()),
  }), log);

  const response = await app.request("http://localhost/api/refresh-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refreshToken: "refresh-token",
    }),
  });
  const payload = await response.json() as Readonly<{ code: string }>;

  assert.equal(response.status, 401);
  assert.equal(payload.code, "REFRESH_TOKEN_FAILED");
});

test("refresh-token returns 500 for non-terminal refresh failures", async () => {
  const app = createTestApp(createRefreshTokenApp({
    refreshTokens: async () => Promise.reject(createNonTerminalRefreshFailure()),
  }), log);

  const response = await app.request("http://localhost/api/refresh-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refreshToken: "refresh-token",
    }),
  });

  assert.equal(response.status, 500);
});
