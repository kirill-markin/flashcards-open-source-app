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
    decideOtpRateLimit: async () => ({ kind: "suppress_email_limit" }),
    loadLatestSentOtpSessionToken: async () => null,
    recordOtpSendDecision: async () => Promise.resolve(),
    createCsrfToken: () => "unused",
    signPayload: () => "unused",
    parseSignedOtpSessionToken: () => {
      throw new Error("parseSignedOtpSessionToken should not be called");
    },
    jitterDelay: async () => Promise.resolve(),
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({ email: "user@example.com" }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 429);
  assert.equal(body.code, "RATE_LIMITED");
});
