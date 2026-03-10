import assert from "node:assert/strict";
import test from "node:test";
import { createAgentVerifyCodeApp } from "./agentVerifyCode.js";

const makeJsonRequest = (body: Readonly<Record<string, string>>): Request =>
  new Request("http://localhost/api/agent/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("agent verify-code rejects an invalid OTP handle", async () => {
  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => ({ status: "invalid" }),
    verifyEmailOtp: async () => {
      throw new Error("verifyEmailOtp should not be called");
    },
    markAgentOtpChallengeUsed: async () => Promise.resolve(),
    normalizeAgentApiKeyLabel: (label: string) => label.trim(),
    createAgentApiKeyFromIdToken: async () => {
      throw new Error("createAgentApiKeyFromIdToken should not be called");
    },
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    otpSessionToken: "bad-token",
    label: "agent",
  }));
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "OTP_SESSION_EXPIRED");
});

test("agent verify-code returns env-var guidance with the new API key", async () => {
  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => ({
      status: "active",
      email: "user@example.com",
      cognitoSession: "session-1",
    }),
    verifyEmailOtp: async () => ({
      idToken: "header.payload.signature",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    }),
    markAgentOtpChallengeUsed: async () => Promise.resolve(),
    normalizeAgentApiKeyLabel: (label: string) => label.trim(),
    createAgentApiKeyFromIdToken: async () => ({
      apiKey: "fca_ABCDEFGH_0123456789ABCDEFGHJKMNPQRS",
      connection: {
        connectionId: "connection-1",
        label: "agent",
        createdAt: "2026-03-10T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    }),
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    otpSessionToken: "ABCD-EFGH-IJKL-MNPQ-1234",
    label: "agent",
  }));
  const body = await response.json() as { ok: boolean; instructions: string; data: { apiKey: string } };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.apiKey, "fca_ABCDEFGH_0123456789ABCDEFGHJKMNPQRS");
  assert.match(body.instructions, /FLASHCARDS_OPEN_SOURCE_API_KEY/);
  assert.match(body.instructions, /do not rely on chat history alone/i);
  assert.match(body.instructions, /saved outside this conversation/i);
  assert.match(body.instructions, /new dialog or session on the same machine/i);
  assert.match(body.instructions, /ask the user for permission before writing to \.env or any file/i);
  assert.match(body.instructions, /export FLASHCARDS_OPEN_SOURCE_API_KEY=/);
  assert.match(body.instructions, /Authorization: ApiKey \$FLASHCARDS_OPEN_SOURCE_API_KEY/);
  assert.match(body.instructions, /load_account/);
});
