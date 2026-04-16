import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createRefreshSessionApp } from "./routes/refreshSession.js";
import { createRefreshTokenApp } from "./routes/refreshToken.js";
import type { AuthAppEnv } from "./server/apiErrors.js";

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

function createTestApp(routeApp: Hono<AuthAppEnv>): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.route("/", routeApp);
  return app;
}

function createTerminalRefreshFailure(): Error & { cognitoType: string } {
  const error = new Error("Refresh token is invalid") as Error & { cognitoType: string };
  error.cognitoType = "NotAuthorizedException";
  return error;
}

function createNonTerminalRefreshFailure(): Error & { cognitoType: string } {
  const error = new Error("Cognito internal error") as Error & { cognitoType: string };
  error.cognitoType = "InternalErrorException";
  return error;
}

function getSetCookieValues(response: Response): ReadonlyArray<string> {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
}

test("refresh-session returns 401 and clears cookies when refresh cookie is missing", async () => {
  let clearCookieCallCount = 0;
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
  }));

  const response = await app.request("http://localhost/api/refresh-session", { method: "POST" });
  const payload = await response.json() as Readonly<{ code: string }>;

  assert.equal(response.status, 401);
  assert.equal(payload.code, "REFRESH_TOKEN_MISSING");
  assert.equal(clearCookieCallCount, 1);
  assert.equal(getSetCookieValues(response).length, 3);
});

test("refresh-session returns 401 and clears cookies for terminal refresh failures", async () => {
  let clearCookieCallCount = 0;
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
  }));

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      cookie: "refresh=refresh-token",
    },
  });
  const payload = await response.json() as Readonly<{ code: string }>;

  assert.equal(response.status, 401);
  assert.equal(payload.code, "REFRESH_TOKEN_FAILED");
  assert.equal(clearCookieCallCount, 1);
  assert.equal(getSetCookieValues(response).length, 3);
});

test("refresh-session bubbles non-terminal refresh failures as 500 without clearing cookies", async () => {
  let clearCookieCallCount = 0;
  const app = createTestApp(createRefreshSessionApp({
    refreshTokens: async () => Promise.reject(createNonTerminalRefreshFailure()),
    setBrowserSessionCookies: () => {
      throw new Error("setBrowserSessionCookies must not be called");
    },
    clearBrowserSessionCookies: () => {
      clearCookieCallCount += 1;
    },
  }));

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      cookie: "refresh=refresh-token",
    },
  });

  assert.equal(response.status, 500);
  assert.equal(clearCookieCallCount, 0);
  assert.equal(getSetCookieValues(response).length, 0);
});

test("refresh-token returns 401 for terminal refresh failures", async () => {
  const app = createTestApp(createRefreshTokenApp({
    refreshTokens: async () => Promise.reject(createTerminalRefreshFailure()),
  }));

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
  }));

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
