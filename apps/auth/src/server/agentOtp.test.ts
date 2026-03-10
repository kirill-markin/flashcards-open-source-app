import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_OTP_TTL_MS,
  createAgentOtpSessionToken,
  isAgentOtpExpired,
  parseAgentOtpSessionToken,
} from "./agentOtp.js";

process.env.SESSION_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("agent OTP tokens round-trip the signed session payload", () => {
  const token = createAgentOtpSessionToken("session-1", "kirill@example.com");
  const payload = parseAgentOtpSessionToken(token);

  assert.equal(payload.s, "session-1");
  assert.equal(payload.e, "kirill@example.com");
  assert.equal(typeof payload.t, "number");
});

test("isAgentOtpExpired respects the fixed OTP lifetime", () => {
  const payload = {
    s: "session-1",
    e: "kirill@example.com",
    t: 1_000,
  };

  assert.equal(isAgentOtpExpired(payload, payload.t + AGENT_OTP_TTL_MS), false);
  assert.equal(isAgentOtpExpired(payload, payload.t + AGENT_OTP_TTL_MS + 1), true);
});
