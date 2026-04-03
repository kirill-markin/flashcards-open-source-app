import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSendCodeApp } from "./routes/agentSendCode.js";
import { createAgentVerifyCodeApp } from "./routes/agentVerifyCode.js";
import type { CreatedAgentApiKey } from "./server/agentApiKeys.js";
import type { AgentOtpChallengeLookup } from "./server/agentOtpChallenges.js";
import type { OtpVerifyAttemptState, OtpVerifyFailureRecordResult } from "./server/otpVerifyAttempts.js";
import type { TokenResult } from "./server/cognitoAuth.js";

type AgentSendCodeResponse = Readonly<{
  ok: boolean;
  data: Readonly<{
    email: string;
    otpSessionToken: string;
    expiresInSeconds: number;
    authBaseUrl: string;
    apiBaseUrl: string;
  }>;
  actions: ReadonlyArray<Readonly<{
    name: string;
    method: string;
    url?: string;
  }>>;
  docs: Readonly<{
    openapiUrl: string;
    swaggerUrl: string;
  }>;
}>;

type AgentVerifyCodeResponse = Readonly<{
  ok: boolean;
  data: Readonly<{
    apiKey: string;
    authorizationScheme: string;
    apiBaseUrl: string;
    connection: Readonly<{
      connectionId: string;
      label: string;
      createdAt: string;
      lastUsedAt: string | null;
      revokedAt: string | null;
    }>;
  }>;
  actions: ReadonlyArray<Readonly<{
    name: string;
    method: string;
    url?: string;
    urlTemplate?: string;
  }>>;
}>;

type AgentErrorResponse = Readonly<{
  ok: boolean;
  error?: Readonly<{
    code: string;
    message: string;
  }>;
}>;

type SendCodeDecision = Readonly<{ kind: "send" }>;

function createTokenResult(idToken: string): TokenResult {
  return {
    idToken,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: 3600,
  };
}

function createApiKeyResult(label: string): CreatedAgentApiKey {
  return {
    apiKey: "fca_TESTKEY_TESTSECRET",
    connection: {
      connectionId: "connection-1",
      label,
      createdAt: "2026-04-03T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

function createActiveChallenge(email: string, cognitoSession: string): AgentOtpChallengeLookup {
  return {
    status: "active",
    email,
    cognitoSession,
    expiresAt: "2026-04-03T00:03:00.000Z",
  };
}

function createActiveAttemptState(): OtpVerifyAttemptState {
  return {
    status: "active",
    failedAttemptCount: 0,
    expiresAt: "2026-04-03T00:03:00.000Z",
  };
}

function createUnusedFailureResult(): OtpVerifyFailureRecordResult {
  return {
    failedAttemptCount: 1,
    locked: false,
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

test("agent send-code uses Cognito OTP for non-demo emails", async () => {
  let initiateEmailOtpCalled = false;
  let createdChallengeSession = "";
  let recordedDecision: string | null = null;

  const app = createAgentSendCodeApp({
    initiateEmailOtp: async (email) => {
      initiateEmailOtpCalled = true;
      assert.equal(email, "user@example.com");
      return { session: "cognito-session-1" };
    },
    getDemoEmailPassword: async () => null,
    decideOtpRateLimit: async () => ({ kind: "send" }),
    recordOtpSendDecision: async (_email, _ipAddress, decision) => {
      recordedDecision = decision;
    },
    createAgentOtpChallenge: async (_email, cognitoSession) => {
      createdChallengeSession = cognitoSession;
      return "AGENT-OTP-TOKEN";
    },
    reissueLatestAgentOtpChallenge: async () => null,
    now: () => 1,
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/agent/send-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "user@example.com",
    }),
  });

  const payload = await readJsonResponse<AgentSendCodeResponse>(response);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.email, "user@example.com");
  assert.equal(payload.data.otpSessionToken, "AGENT-OTP-TOKEN");
  assert.equal(payload.actions[0]?.name, "verify_code");
  assert.equal(initiateEmailOtpCalled, true);
  assert.equal(createdChallengeSession, "cognito-session-1");
  assert.equal(recordedDecision, "sent");
});

test("agent send-code issues an opaque challenge for allowlisted demo emails without OTP delivery", async () => {
  let createdChallengeSession = "";

  const app = createAgentSendCodeApp({
    initiateEmailOtp: async () => {
      throw new Error("initiateEmailOtp must not run for demo emails");
    },
    getDemoEmailPassword: async (email) => {
      assert.equal(email, "google-review@example.com");
      return "demo-password";
    },
    decideOtpRateLimit: async () => ({ kind: "send" }),
    recordOtpSendDecision: async () => undefined,
    createAgentOtpChallenge: async (_email, cognitoSession) => {
      createdChallengeSession = cognitoSession;
      return "DEMO-AGENT-OTP";
    },
    reissueLatestAgentOtpChallenge: async () => null,
    now: () => 1,
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/agent/send-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "google-review@example.com",
    }),
  });

  const payload = await readJsonResponse<AgentSendCodeResponse>(response);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.otpSessionToken, "DEMO-AGENT-OTP");
  assert.equal(createdChallengeSession, "demo-agent-session:google-review@example.com");
});

test("agent verify-code uses the OTP challenge for non-demo emails", async () => {
  let verifyEmailOtpCalled = false;
  let signInWithPasswordCalled = false;
  let createdKeyIdToken = "";

  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async (otpSessionToken) => {
      assert.equal(otpSessionToken, "OTP-TOKEN");
      return createActiveChallenge("user@example.com", "cognito-session-1");
    },
    getOtpVerifyAttemptState: async () => createActiveAttemptState(),
    recordOtpVerifyFailure: async () => createUnusedFailureResult(),
    verifyEmailOtp: async (email, code, session) => {
      verifyEmailOtpCalled = true;
      assert.equal(email, "user@example.com");
      assert.equal(code, "12345678");
      assert.equal(session, "cognito-session-1");
      return createTokenResult("otp-id-token");
    },
    signInWithPassword: async () => {
      signInWithPasswordCalled = true;
      throw new Error("signInWithPassword must not run for non-demo emails");
    },
    getDemoEmailPassword: async () => null,
    markAgentOtpChallengeUsed: async () => undefined,
    normalizeAgentApiKeyLabel: (label) => label.trim(),
    createAgentApiKeyFromIdToken: async (idToken, label) => {
      createdKeyIdToken = idToken;
      return createApiKeyResult(label);
    },
    now: () => 1,
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/agent/verify-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code: "12345678",
      otpSessionToken: "OTP-TOKEN",
      label: "ci-agent",
    }),
  });

  const payload = await readJsonResponse<AgentVerifyCodeResponse>(response);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.authorizationScheme, "ApiKey");
  assert.equal(payload.data.connection.label, "ci-agent");
  assert.equal(payload.actions.map((action) => action.name).join(","), "load_account,list_workspaces,create_workspace,select_workspace");
  assert.equal(verifyEmailOtpCalled, true);
  assert.equal(signInWithPasswordCalled, false);
  assert.equal(createdKeyIdToken, "otp-id-token");
});

test("agent verify-code signs in with the demo password for allowlisted demo emails", async () => {
  let signInWithPasswordEmail = "";
  let createdKeyIdToken = "";

  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => createActiveChallenge("google-review@example.com", "demo-agent-session:google-review@example.com"),
    getOtpVerifyAttemptState: async () => createActiveAttemptState(),
    recordOtpVerifyFailure: async () => createUnusedFailureResult(),
    verifyEmailOtp: async () => {
      throw new Error("verifyEmailOtp must not run for demo emails");
    },
    signInWithPassword: async (email, password) => {
      signInWithPasswordEmail = `${email}:${password}`;
      return createTokenResult("demo-id-token");
    },
    getDemoEmailPassword: async () => "demo-password",
    markAgentOtpChallengeUsed: async () => undefined,
    normalizeAgentApiKeyLabel: (label) => label.trim(),
    createAgentApiKeyFromIdToken: async (idToken, label) => {
      createdKeyIdToken = idToken;
      return createApiKeyResult(label);
    },
    now: () => 1,
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/agent/verify-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code: "87654321",
      otpSessionToken: "DEMO-TOKEN",
      label: "agent smoke",
    }),
  });

  const payload = await readJsonResponse<AgentVerifyCodeResponse>(response);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.connection.label, "agent smoke");
  assert.equal(signInWithPasswordEmail, "google-review@example.com:demo-password");
  assert.equal(createdKeyIdToken, "demo-id-token");
});

test("agent verify-code rejects invalid code format before any auth call", async () => {
  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => {
      throw new Error("lookupAgentOtpChallenge must not run for invalid code");
    },
    getOtpVerifyAttemptState: async () => {
      throw new Error("getOtpVerifyAttemptState must not run for invalid code");
    },
    recordOtpVerifyFailure: async () => {
      throw new Error("recordOtpVerifyFailure must not run for invalid code");
    },
    verifyEmailOtp: async () => {
      throw new Error("verifyEmailOtp must not run for invalid code");
    },
    signInWithPassword: async () => {
      throw new Error("signInWithPassword must not run for invalid code");
    },
    getDemoEmailPassword: async () => null,
    markAgentOtpChallengeUsed: async () => undefined,
    normalizeAgentApiKeyLabel: (label) => label.trim(),
    createAgentApiKeyFromIdToken: async () => createApiKeyResult("unused"),
    now: () => 1,
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/agent/verify-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code: "not-a-code",
      otpSessionToken: "OTP-TOKEN",
      label: "ci-agent",
    }),
  });

  const payload = await readJsonResponse<AgentErrorResponse>(response);

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.code, "OTP_CODE_INVALID");
});

test("agent verify-code rejects invalid labels before challenge lookup", async () => {
  const app = createAgentVerifyCodeApp({
    lookupAgentOtpChallenge: async () => {
      throw new Error("lookupAgentOtpChallenge must not run for invalid label");
    },
    getOtpVerifyAttemptState: async () => {
      throw new Error("getOtpVerifyAttemptState must not run for invalid label");
    },
    recordOtpVerifyFailure: async () => {
      throw new Error("recordOtpVerifyFailure must not run for invalid label");
    },
    verifyEmailOtp: async () => {
      throw new Error("verifyEmailOtp must not run for invalid label");
    },
    signInWithPassword: async () => {
      throw new Error("signInWithPassword must not run for invalid label");
    },
    getDemoEmailPassword: async () => null,
    markAgentOtpChallengeUsed: async () => undefined,
    normalizeAgentApiKeyLabel: () => {
      throw new Error("Connection label is required");
    },
    createAgentApiKeyFromIdToken: async () => createApiKeyResult("unused"),
    now: () => 1,
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/agent/verify-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code: "12345678",
      otpSessionToken: "OTP-TOKEN",
      label: "   ",
    }),
  });

  const payload = await readJsonResponse<AgentErrorResponse>(response);

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.code, "INVALID_REQUEST");
  assert.equal(payload.error?.message, "Connection label is required");
});
