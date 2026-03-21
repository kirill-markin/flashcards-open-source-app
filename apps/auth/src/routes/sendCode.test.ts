import assert from "node:assert/strict";
import test from "node:test";
import { createSendCodeApp } from "./sendCode.js";

const makeJsonRequest = (body: Readonly<Record<string, string>>): Request =>
  new Request("http://localhost/api/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("browser send-code reuses an existing unlocked token during suppression", async () => {
  const app = createSendCodeApp({
    initiateEmailOtp: async () => ({ session: "unused" }),
    signInWithPassword: async () => {
      throw new Error("signInWithPassword should not be called");
    },
    decideOtpRateLimit: async () => ({ kind: "suppress_email_limit" }),
    loadLatestSentOtpSessionToken: async () => "signed-token",
    recordOtpSendDecision: async () => Promise.resolve(),
    createCsrfToken: () => "unused",
    signPayload: () => "unused",
    parseSignedOtpSessionToken: () => ({
      s: "session-1",
      e: "user@example.com",
      csrf: "csrf-1",
      t: 123_000,
    }),
    getDemoEmailPassword: async () => null,
    setBrowserSessionCookies: () => undefined,
    jitterDelay: async () => Promise.resolve(),
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({ email: "user@example.com" }));
  const body = await response.json() as { ok: boolean; otpSessionToken: string; csrfToken: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.otpSessionToken, "signed-token");
  assert.equal(body.csrfToken, "csrf-1");
});

test("browser send-code returns RATE_LIMITED when suppression cannot reuse a challenge", async () => {
  const app = createSendCodeApp({
    initiateEmailOtp: async () => ({ session: "unused" }),
    signInWithPassword: async () => {
      throw new Error("signInWithPassword should not be called");
    },
    decideOtpRateLimit: async () => ({ kind: "suppress_email_limit" }),
    loadLatestSentOtpSessionToken: async () => null,
    recordOtpSendDecision: async () => Promise.resolve(),
    createCsrfToken: () => "unused",
    signPayload: () => "unused",
    parseSignedOtpSessionToken: () => {
      throw new Error("parseSignedOtpSessionToken should not be called");
    },
    getDemoEmailPassword: async () => null,
    setBrowserSessionCookies: () => undefined,
    jitterDelay: async () => Promise.resolve(),
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({ email: "user@example.com" }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 429);
  assert.equal(body.code, "RATE_LIMITED");
});

test("browser send-code returns tokens immediately for configured demo emails", async () => {
  let otpInitiationCalls = 0;
  let cookieCalls = 0;
  const app = createSendCodeApp({
    initiateEmailOtp: async () => {
      otpInitiationCalls += 1;
      return { session: "unused" };
    },
    signInWithPassword: async (email: string, password: string) => {
      assert.equal(email, "apple-for-review@example.com");
      assert.equal(password, "shared-demo-password");
      return {
        idToken: "id-token",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      };
    },
    decideOtpRateLimit: async () => ({ kind: "send" }),
    loadLatestSentOtpSessionToken: async () => null,
    recordOtpSendDecision: async () => Promise.resolve(),
    createCsrfToken: () => "unused",
    signPayload: () => "unused",
    parseSignedOtpSessionToken: () => {
      throw new Error("parseSignedOtpSessionToken should not be called");
    },
    getDemoEmailPassword: async () => "shared-demo-password",
    setBrowserSessionCookies: () => {
      cookieCalls += 1;
    },
    jitterDelay: async () => Promise.resolve(),
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({ email: "apple-for-review@example.com" }));
  const body = await response.json() as { ok: boolean; idToken: string; refreshToken: string; expiresIn: number };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.idToken, "id-token");
  assert.equal(body.refreshToken, "refresh-token");
  assert.equal(body.expiresIn, 3600);
  assert.equal(otpInitiationCalls, 0);
  assert.equal(cookieCalls, 1);
});
