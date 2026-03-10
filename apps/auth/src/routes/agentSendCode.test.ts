import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSendCodeApp } from "./agentSendCode.js";

const makeJsonRequest = (body: Readonly<Record<string, string>>): Request =>
  new Request("http://localhost/api/agent/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("agent send-code returns a short opaque handle when OTP email is sent", async () => {
  const calls: Array<string> = [];
  const app = createAgentSendCodeApp({
    initiateEmailOtp: async (email: string) => {
      calls.push(email);
      return { session: "session-1" };
    },
    decideOtpRateLimit: async () => ({ kind: "send" }),
    recordOtpSendDecision: async () => Promise.resolve(),
    createAgentOtpChallenge: async (_email: string, _cognitoSession: string) => "ABCD-EFGH-IJKL-MNPQ-1234",
    reissueLatestAgentOtpChallenge: async () => null,
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({ email: "User@Example.com" }));
  const body = await response.json() as { ok: boolean; instructions: string; data: { otpSessionToken: string } };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.otpSessionToken, "ABCD-EFGH-IJKL-MNPQ-1234");
  assert.doesNotMatch(body.instructions, /FLASHCARDS_OPEN_SOURCE_API_KEY/);
  assert.deepEqual(calls, ["user@example.com"]);
});

test("agent send-code reissues the latest handle without sending another email", async () => {
  const calls: Array<string> = [];
  const app = createAgentSendCodeApp({
    initiateEmailOtp: async (email: string) => {
      calls.push(email);
      return { session: "session-1" };
    },
    decideOtpRateLimit: async () => ({ kind: "suppress_email_limit" }),
    recordOtpSendDecision: async () => Promise.resolve(),
    createAgentOtpChallenge: async () => "UNUSED",
    reissueLatestAgentOtpChallenge: async () => "QRST-VWXY-Z234-5678-9ABC",
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({ email: "user@example.com" }));
  const body = await response.json() as { ok: boolean; data: { otpSessionToken: string } };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.otpSessionToken, "QRST-VWXY-Z234-5678-9ABC");
  assert.deepEqual(calls, []);
});
