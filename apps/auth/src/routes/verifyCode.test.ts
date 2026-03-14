import assert from "node:assert/strict";
import test from "node:test";
import { createVerifyCodeApp } from "./verifyCode.js";

const makeInvalidCodeError = (): Error & { cognitoType: string } => {
  const error = new Error("Code mismatch");
  (error as Error & { cognitoType: string }).cognitoType = "CodeMismatchException";
  return error as Error & { cognitoType: string };
};

const makeJsonRequest = (body: Readonly<Record<string, string>>): Request =>
  new Request("http://localhost/api/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const basePayload = {
  s: "session-1",
  e: "user@example.com",
  csrf: "csrf-1",
  t: 0,
} as const;

test("browser verify-code returns OTP_CODE_INVALID below the lockout threshold", async () => {
  let recordCalls = 0;
  const app = createVerifyCodeApp({
    verifySignedOtpSession: () => basePayload,
    getOtpVerifyAttemptState: async () => ({ status: "expired_or_missing" }),
    recordOtpVerifyFailure: async () => {
      recordCalls += 1;
      return { failedAttemptCount: 1, locked: false };
    },
    verifyEmailOtp: async () => {
      throw makeInvalidCodeError();
    },
    setBrowserSessionCookies: () => undefined,
    clearOtpSessionCookie: () => undefined,
    now: () => 60_000,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    csrfToken: "csrf-1",
    otpSessionToken: "signed-token",
  }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "OTP_CODE_INVALID");
  assert.equal(recordCalls, 1);
});

test("browser verify-code returns OTP_TOO_MANY_ATTEMPTS on the fifth invalid code", async () => {
  const app = createVerifyCodeApp({
    verifySignedOtpSession: () => basePayload,
    getOtpVerifyAttemptState: async () => ({ status: "active", failedAttemptCount: 4, expiresAt: "2026-03-14T07:03:00.000Z" }),
    recordOtpVerifyFailure: async () => ({ failedAttemptCount: 5, locked: true }),
    verifyEmailOtp: async () => {
      throw makeInvalidCodeError();
    },
    setBrowserSessionCookies: () => undefined,
    clearOtpSessionCookie: () => undefined,
    now: () => 60_000,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    csrfToken: "csrf-1",
    otpSessionToken: "signed-token",
  }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 429);
  assert.equal(body.code, "OTP_TOO_MANY_ATTEMPTS");
});

test("browser verify-code short-circuits locked challenges before Cognito", async () => {
  let verifyCalls = 0;
  const app = createVerifyCodeApp({
    verifySignedOtpSession: () => basePayload,
    getOtpVerifyAttemptState: async () => ({
      status: "locked",
      failedAttemptCount: 5,
      expiresAt: "2026-03-14T07:03:00.000Z",
      lockedAt: "2026-03-14T07:01:00.000Z",
    }),
    recordOtpVerifyFailure: async () => ({ failedAttemptCount: 5, locked: true }),
    verifyEmailOtp: async () => {
      verifyCalls += 1;
      throw new Error("verifyEmailOtp should not be called");
    },
    setBrowserSessionCookies: () => undefined,
    clearOtpSessionCookie: () => undefined,
    now: () => 60_000,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    csrfToken: "csrf-1",
    otpSessionToken: "signed-token",
  }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 429);
  assert.equal(body.code, "OTP_TOO_MANY_ATTEMPTS");
  assert.equal(verifyCalls, 0);
});

test("browser verify-code does not record failures for provider errors", async () => {
  let recordCalls = 0;
  const app = createVerifyCodeApp({
    verifySignedOtpSession: () => basePayload,
    getOtpVerifyAttemptState: async () => ({ status: "expired_or_missing" }),
    recordOtpVerifyFailure: async () => {
      recordCalls += 1;
      return { failedAttemptCount: 1, locked: false };
    },
    verifyEmailOtp: async () => {
      throw new Error("provider unavailable");
    },
    setBrowserSessionCookies: () => undefined,
    clearOtpSessionCookie: () => undefined,
    now: () => 60_000,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    csrfToken: "csrf-1",
    otpSessionToken: "signed-token",
  }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "OTP_VERIFY_FAILED");
  assert.equal(recordCalls, 0);
});

test("browser verify-code succeeds when the challenge is still below the threshold", async () => {
  let setSessionCalls = 0;
  let clearCookieCalls = 0;
  const app = createVerifyCodeApp({
    verifySignedOtpSession: () => basePayload,
    getOtpVerifyAttemptState: async () => ({ status: "active", failedAttemptCount: 4, expiresAt: "2026-03-14T07:03:00.000Z" }),
    recordOtpVerifyFailure: async () => ({ failedAttemptCount: 5, locked: true }),
    verifyEmailOtp: async () => ({
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    }),
    setBrowserSessionCookies: () => {
      setSessionCalls += 1;
    },
    clearOtpSessionCookie: () => {
      clearCookieCalls += 1;
    },
    now: () => 60_000,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    csrfToken: "csrf-1",
    otpSessionToken: "signed-token",
  }));
  const body = await response.json() as { ok: boolean; idToken: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.idToken, "id-token");
  assert.equal(setSessionCalls, 1);
  assert.equal(clearCookieCalls, 1);
});
