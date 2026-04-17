import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, type AuthRequest, type AuthResult } from "../auth";
import { resetAuthConfigForTests } from "../authConfig";
import { HttpError } from "../errors";
import { requireAdminRequestWithDependencies } from "./authz";

function createRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

function createAuthenticatedResult(
  transport: AuthResult["transport"],
  email: string | null,
): AuthResult {
  return {
    userId: "user-1",
    email,
    cognitoUsername: "user-1",
    subjectUserId: "subject-1",
    transport,
    connectionId: null,
    selectedWorkspaceId: null,
  };
}

test.afterEach(() => {
  delete process.env.AUTH_MODE;
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  resetAuthConfigForTests();
});

test("requireAdminRequestWithDependencies propagates unauthenticated requests as 401", async () => {
  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("http://localhost/admin/session"),
      [],
      {
        authenticateRequestFn: async (_request: AuthRequest): Promise<AuthResult> => {
          throw new AuthError(401, "Missing authentication token");
        },
        hasActiveAdminGrantFn: async (): Promise<boolean> => true,
      },
    ),
    (error: unknown) => error instanceof AuthError && error.statusCode === 401,
  );
});

test("requireAdminRequestWithDependencies rejects non-human transports", async () => {
  for (const transport of ["guest", "api_key"] as const) {
    await assert.rejects(
      requireAdminRequestWithDependencies(
        createRequest("http://localhost/admin/session"),
        [],
        {
          authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult(transport, null),
          hasActiveAdminGrantFn: async (): Promise<boolean> => true,
        },
      ),
      (error: unknown) => (
        error instanceof HttpError
        && error.statusCode === 403
        && error.code === "ADMIN_HUMAN_AUTH_REQUIRED"
      ),
    );
  }
});

test("requireAdminRequestWithDependencies rejects bearer-token admin access", async () => {
  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("http://localhost/admin/session"),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("bearer", "admin@example.com"),
        hasActiveAdminGrantFn: async (): Promise<boolean> => true,
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 403
      && error.code === "ADMIN_HUMAN_AUTH_REQUIRED"
    ),
  );
});

test("requireAdminRequestWithDependencies accepts localhost admin requests in AUTH_MODE=none", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";

  let hasActiveAdminGrantCalls = 0;
  const result = await requireAdminRequestWithDependencies(
    createRequest("http://localhost/admin/session"),
    [],
    {
      authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("none", null),
      hasActiveAdminGrantFn: async (): Promise<boolean> => {
        hasActiveAdminGrantCalls += 1;
        return true;
      },
    },
  );

  assert.equal(hasActiveAdminGrantCalls, 0);
  assert.deepEqual(result, {
    email: "local-admin@localhost",
    transport: "none",
    userId: "user-1",
    subjectUserId: "subject-1",
    requestAuthInputs: {
      authorizationHeader: undefined,
      sessionToken: undefined,
      csrfTokenHeader: undefined,
      originHeader: undefined,
      refererHeader: undefined,
      secFetchSiteHeader: undefined,
    },
  });
});

test("requireAdminRequestWithDependencies rejects AUTH_MODE=none admin requests on non-local hosts", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";

  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("https://api.flashcards-open-source-app.com/admin/session"),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("none", null),
        hasActiveAdminGrantFn: async (): Promise<boolean> => true,
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 403
      && error.code === "ADMIN_LOCALHOST_ONLY"
    ),
  );
});

test("requireAdminRequestWithDependencies rejects signed-in non-admin users", async () => {
  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("http://localhost/admin/session"),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("session", "viewer@example.com"),
        hasActiveAdminGrantFn: async (): Promise<boolean> => false,
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 403
      && error.code === "ADMIN_ACCESS_REQUIRED"
    ),
  );
});

test("requireAdminRequestWithDependencies accepts signed-in admins and normalizes email", async () => {
  const result = await requireAdminRequestWithDependencies(
    createRequest("http://localhost/admin/session"),
    [],
    {
      authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("session", "Admin@Example.com "),
      hasActiveAdminGrantFn: async (): Promise<boolean> => true,
    },
  );

  assert.deepEqual(result, {
    email: "admin@example.com",
    transport: "session",
    userId: "user-1",
    subjectUserId: "subject-1",
    requestAuthInputs: {
      authorizationHeader: undefined,
      sessionToken: undefined,
      csrfTokenHeader: undefined,
      originHeader: undefined,
      refererHeader: undefined,
      secFetchSiteHeader: undefined,
    },
  });
});
