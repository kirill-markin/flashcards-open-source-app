import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { authenticateRequest, AuthError, extractVerifiedIdTokenIdentity } from "./auth";
import { resetAuthConfigForTests } from "./authConfig";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;

function restoreAuthEnv(): void {
  if (originalAuthMode === undefined) {
    delete process.env.AUTH_MODE;
  } else {
    process.env.AUTH_MODE = originalAuthMode;
  }

  if (originalAllowInsecureLocalAuth === undefined) {
    delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  } else {
    process.env.ALLOW_INSECURE_LOCAL_AUTH = originalAllowInsecureLocalAuth;
  }

  resetAuthConfigForTests();
}

afterEach(restoreAuthEnv);

test("authenticateRequest returns local auth only for explicitly gated insecure mode", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";

  const result = await authenticateRequest({
    authorizationHeader: undefined,
    sessionToken: undefined,
  });

  assert.deepEqual(result, {
    userId: "local",
    email: null,
    cognitoUsername: null,
    subjectUserId: "local",
    transport: "none",
    connectionId: null,
    selectedWorkspaceId: null,
  });
});

test("authenticateRequest rejects unauthenticated requests in cognito mode", async () => {
  process.env.AUTH_MODE = "cognito";
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;

  await assert.rejects(
    () => authenticateRequest({
      authorizationHeader: undefined,
      sessionToken: undefined,
    }),
    (error: unknown) => error instanceof AuthError
      && error.statusCode === 401
      && error.message === "Missing authentication token",
  );
});

test("extractVerifiedIdTokenIdentity returns userId and email", () => {
  assert.deepEqual(
    extractVerifiedIdTokenIdentity({
      sub: "user-123",
      email: "user@example.com",
      "cognito:username": "kirill@example.com",
    }),
    {
      userId: "user-123",
      email: "user@example.com",
      cognitoUsername: "kirill@example.com",
    },
  );
});

test("extractVerifiedIdTokenIdentity rejects missing email claim", () => {
  assert.throws(
    () => extractVerifiedIdTokenIdentity({
      sub: "user-123",
    }),
    (error: unknown) => error instanceof Error
      && error.message === "Cognito ID token is missing email claim",
  );
});
