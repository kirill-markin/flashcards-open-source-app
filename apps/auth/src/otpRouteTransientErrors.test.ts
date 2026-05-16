import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createSendCodeApp } from "./routes/sendCode.js";
import { createVerifyCodeApp } from "./routes/verifyCode.js";
import type { AuthAppEnv } from "./server/apiErrors.js";
import type { OtpVerifyAttemptState } from "./server/otpVerifyAttempts.js";

type ServiceUnavailableResponse = Readonly<{
  error: string;
  requestId: string;
  code: string;
}>;

type ErrorWithCode = Error & Readonly<{
  code: string;
}>;

function createErrorWithCode(message: string, code: string): ErrorWithCode {
  const error = new Error(message) as ErrorWithCode;
  Object.defineProperty(error, "code", {
    value: code,
    enumerable: true,
  });
  return error;
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

function createActiveAttemptState(): OtpVerifyAttemptState {
  return {
    status: "active",
    failedAttemptCount: 0,
    expiresAt: "2026-04-03T00:03:00.000Z",
  };
}

test("send-code returns non-retry-guided 503 after post-email transient DB failure", async () => {
  let initiateEmailOtpCalled = false;
  let recordOtpSendDecisionCalled = false;

  const app = createTestApp(createSendCodeApp({
    initiateEmailOtp: async (email) => {
      initiateEmailOtpCalled = true;
      assert.equal(email, "user@example.com");
      return { session: "cognito-session-1" };
    },
    signInWithPassword: async () => {
      throw new Error("signInWithPassword must not run");
    },
    decideOtpRateLimit: async () => ({ kind: "send" }),
    loadLatestSentOtpSessionToken: async () => null,
    recordOtpSendDecision: async (_email, _ipAddress, decision, otpSessionToken) => {
      recordOtpSendDecisionCalled = true;
      assert.equal(decision, "sent");
      assert.equal(otpSessionToken, "signed-otp-session");
      throw createErrorWithCode("terminating connection due to administrator command", "57P01");
    },
    createCsrfToken: () => "csrf-token",
    signPayload: () => "signed-otp-session",
    parseSignedOtpSessionToken: () => {
      throw new Error("parseSignedOtpSessionToken must not run");
    },
    getDemoEmailPassword: async () => null,
    setBrowserSessionCookies: () => undefined,
    jitterDelay: async () => undefined,
    now: () => 1,
  }));

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/send-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "user@example.com",
    }),
  });
  const payload = await response.json() as ServiceUnavailableResponse;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(payload.code, "SERVICE_UNAVAILABLE");
  assert.equal(payload.error, "A verification email may have been sent, but sign-in could not be prepared.");
  assert.equal(payload.requestId, "request-1");
  assert.equal(initiateEmailOtpCalled, true);
  assert.equal(recordOtpSendDecisionCalled, true);
});

test("verify-code returns non-retry-guided 503 when invalid-code recording hits transient DB failure", async () => {
  let recordOtpVerifyFailureCalled = false;
  let setBrowserSessionCookiesCalled = false;

  const app = createTestApp(createVerifyCodeApp({
    verifySignedOtpSession: () => ({
      s: "cognito-session-1",
      e: "user@example.com",
      csrf: "csrf-token",
      t: 1,
    }),
    getOtpVerifyAttemptState: async () => createActiveAttemptState(),
    recordOtpVerifyFailure: async () => {
      recordOtpVerifyFailureCalled = true;
      throw createErrorWithCode("terminating connection due to administrator command", "57P01");
    },
    verifyEmailOtp: async () => {
      throw new Error("Invalid code");
    },
    setBrowserSessionCookies: () => {
      setBrowserSessionCookiesCalled = true;
    },
    clearOtpSessionCookie: () => undefined,
    now: () => 1,
  }));

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/verify-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code: "12345678",
      csrfToken: "csrf-token",
      otpSessionToken: "signed-otp-session",
    }),
  });
  const payload = await response.json() as ServiceUnavailableResponse;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), null);
  assert.equal(payload.code, "SERVICE_UNAVAILABLE");
  assert.equal(payload.error, "The code was rejected, but the invalid attempt could not be recorded.");
  assert.equal(payload.requestId, "request-1");
  assert.equal(recordOtpVerifyFailureCalled, true);
  assert.equal(setBrowserSessionCookiesCalled, false);
});
