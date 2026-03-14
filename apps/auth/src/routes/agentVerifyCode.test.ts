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
    getOtpVerifyAttemptState: async () => ({ status: "expired_or_missing" }),
    recordOtpVerifyFailure: async () => ({ failedAttemptCount: 1, locked: false }),
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
      expiresAt: "2026-03-14T07:03:00.000Z",
    }),
    getOtpVerifyAttemptState: async () => ({ status: "expired_or_missing" }),
    recordOtpVerifyFailure: async () => ({ failedAttemptCount: 1, locked: false }),
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
  const body = await response.json() as {
    ok: boolean;
    instructions: string;
    data: { apiKey: string };
    actions: ReadonlyArray<Readonly<{ name: string }>>;
  };

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
  assert.match(body.instructions, /GET .*\/agent\/me/);
  assert.match(body.instructions, /GET .*\/agent\/workspaces/);
  assert.match(body.instructions, /POST .*\/agent\/workspaces\/\{workspaceId\}\/select/);
  assert.match(body.instructions, /Read payload from data\.\*/);
  assert.match(body.instructions, /confirm it with actions/i);
  assert.deepEqual(body.actions.map((action) => action.name), [
    "load_account",
    "list_workspaces",
    "create_workspace",
    "select_workspace",
  ]);
});

test("agent verify-code returns OTP_TOO_MANY_ATTEMPTS on the fifth invalid code", async () => {
  const invalidCodeError = new Error("Code mismatch") as Error & { cognitoType: string };
  invalidCodeError.cognitoType = "CodeMismatchException";

  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => ({
      status: "active",
      email: "user@example.com",
      cognitoSession: "session-1",
      expiresAt: "2026-03-14T07:03:00.000Z",
    }),
    getOtpVerifyAttemptState: async () => ({ status: "active", failedAttemptCount: 4, expiresAt: "2026-03-14T07:03:00.000Z" }),
    recordOtpVerifyFailure: async () => ({ failedAttemptCount: 5, locked: true }),
    verifyEmailOtp: async () => {
      throw invalidCodeError;
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
    otpSessionToken: "ABCD-EFGH-IJKL-MNPQ-1234",
    label: "agent",
  }));
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 429);
  assert.equal(body.error.code, "OTP_TOO_MANY_ATTEMPTS");
});

test("agent verify-code short-circuits locked challenges", async () => {
  let verifyCalls = 0;
  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => ({
      status: "active",
      email: "user@example.com",
      cognitoSession: "session-1",
      expiresAt: "2026-03-14T07:03:00.000Z",
    }),
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
    markAgentOtpChallengeUsed: async () => Promise.resolve(),
    normalizeAgentApiKeyLabel: (label: string) => label.trim(),
    createAgentApiKeyFromIdToken: async () => {
      throw new Error("createAgentApiKeyFromIdToken should not be called");
    },
    now: () => 123_456,
  });

  const response = await app.request(makeJsonRequest({
    code: "12345678",
    otpSessionToken: "ABCD-EFGH-IJKL-MNPQ-1234",
    label: "agent",
  }));
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 429);
  assert.equal(body.error.code, "OTP_TOO_MANY_ATTEMPTS");
  assert.equal(verifyCalls, 0);
});
