import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, type AuthRequest, type AuthResult } from "../auth";
import { resetAuthConfigForTests } from "../auth/config";
import { HttpError } from "../shared/errors";
import {
  requireAdminRequestWithDependencies,
  requireCatalogAdminRequestWithDependencies,
} from "./authz";

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
    guestSessionId: transport === "guest" ? "guest-session-1" : null,
    guestPlatform: transport === "guest" ? "ios" : null,
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
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run for unauthenticated requests");
        },
        hasActiveAdminGrantFn: async (): Promise<boolean> => true,
      },
    ),
    (error: unknown) => error instanceof AuthError && error.statusCode === 401,
  );
});

test("requireAdminRequestWithDependencies rejects guest admin access", async () => {
  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("http://localhost/admin/session"),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("guest", null),
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run for guest transport");
        },
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

test("requireAdminRequestWithDependencies still rejects API-key admin access", async () => {
  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("http://localhost/admin/session"),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("api_key", null),
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run for API-key transport");
        },
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

test("requireAdminRequestWithDependencies rejects bearer-token admin access", async () => {
  await assert.rejects(
    requireAdminRequestWithDependencies(
      createRequest("http://localhost/admin/session"),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("bearer", "admin@example.com"),
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run for bearer transport");
        },
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

test("requireCatalogAdminRequestWithDependencies accepts an active admin API key without CSRF", async () => {
  const auth = {
    ...createAuthenticatedResult("api_key", null),
    userId: "canonical-user",
    subjectUserId: "canonical-user",
  } satisfies AuthResult;
  const request = new Request("https://api.flashcards-open-source-app.com/admin/catalog/packages", {
    method: "POST",
    headers: { Authorization: "ApiKey fca_test" },
  });
  const result = await requireCatalogAdminRequestWithDependencies(
    request,
    [],
    {
      authenticateRequestFn: async (authRequest): Promise<AuthResult> => {
        assert.deepEqual(authRequest, {
          authorizationHeader: "ApiKey fca_test",
          sessionToken: undefined,
        });
        return auth;
      },
      ensureCognitoUserProfileFn: async () => {
        throw new Error("ensureCognitoUserProfileFn should not run for API-key transport");
      },
      hasActiveAdminGrantFn: async (email): Promise<boolean> => {
        assert.equal(email, "admin@example.com");
        return true;
      },
      loadAdminProfileEmailFn: async (userId) => {
        assert.equal(userId, "canonical-user");
        return { email: " Admin@Example.com " };
      },
    },
  );

  assert.deepEqual(result, {
    email: "admin@example.com",
    transport: "api_key",
    userId: "canonical-user",
    subjectUserId: "canonical-user",
    requestAuthInputs: {
      authorizationHeader: "ApiKey fca_test",
      sessionToken: undefined,
      csrfTokenHeader: undefined,
      originHeader: undefined,
      refererHeader: undefined,
      secFetchSiteHeader: undefined,
    },
  });
});

test("requireCatalogAdminRequestWithDependencies rejects API keys without a profile email", async () => {
  const missingProfiles: ReadonlyArray<Readonly<{
    expectedMessage: string;
    profile: Readonly<{ email: string | null }> | null;
  }>> = [
    {
      expectedMessage: "Catalog admin API-key access requires an existing user profile.",
      profile: null,
    },
    {
      expectedMessage: "Catalog admin API-key access requires a profile email.",
      profile: { email: null },
    },
  ];

  for (const scenario of missingProfiles) {
    await assert.rejects(
      requireCatalogAdminRequestWithDependencies(
        new Request("https://api.flashcards-open-source-app.com/admin/catalog/packages", {
          headers: { Authorization: "ApiKey fca_test" },
        }),
        [],
        {
          authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("api_key", null),
          ensureCognitoUserProfileFn: async () => {
            throw new Error("ensureCognitoUserProfileFn should not run for API-key transport");
          },
          hasActiveAdminGrantFn: async () => {
            throw new Error("hasActiveAdminGrantFn should not run without a profile email");
          },
          loadAdminProfileEmailFn: async () => scenario.profile,
        },
      ),
      (error: unknown) => (
        error instanceof HttpError
        && error.statusCode === 403
        && error.code === "ADMIN_ACCESS_REQUIRED"
        && error.message === scenario.expectedMessage
      ),
    );
  }
});

test("requireCatalogAdminRequestWithDependencies rejects API keys without an active admin grant", async () => {
  await assert.rejects(
    requireCatalogAdminRequestWithDependencies(
      new Request("https://api.flashcards-open-source-app.com/admin/catalog/packages", {
        headers: { Authorization: "ApiKey fca_test" },
      }),
      [],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult("api_key", null),
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run for API-key transport");
        },
        hasActiveAdminGrantFn: async (email): Promise<boolean> => {
          assert.equal(email, "viewer@example.com");
          return false;
        },
        loadAdminProfileEmailFn: async () => ({ email: " Viewer@Example.com " }),
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 403
      && error.code === "ADMIN_ACCESS_REQUIRED"
    ),
  );
});

test("requireCatalogAdminRequestWithDependencies rejects bearer and guest transports", async () => {
  for (const transport of ["bearer", "guest"] as const) {
    await assert.rejects(
      requireCatalogAdminRequestWithDependencies(
        createRequest("https://api.flashcards-open-source-app.com/admin/catalog/packages"),
        [],
        {
          authenticateRequestFn: async (): Promise<AuthResult> => createAuthenticatedResult(transport, null),
          ensureCognitoUserProfileFn: async () => {
            throw new Error("ensureCognitoUserProfileFn should not run for bearer or guest transport");
          },
          hasActiveAdminGrantFn: async () => {
            throw new Error("hasActiveAdminGrantFn should not run for bearer or guest transport");
          },
          loadAdminProfileEmailFn: async () => {
            throw new Error("loadAdminProfileEmailFn should not run for bearer or guest transport");
          },
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

test("requireCatalogAdminRequestWithDependencies preserves session profile reconciliation", async () => {
  const result = await requireCatalogAdminRequestWithDependencies(
    createRequest("https://api.flashcards-open-source-app.com/admin/catalog/packages"),
    [],
    {
      authenticateRequestFn: async (): Promise<AuthResult> => (
        createAuthenticatedResult("session", " Admin@Example.com ")
      ),
      ensureCognitoUserProfileFn: async (subjectUserId, email) => {
        assert.equal(subjectUserId, "subject-1");
        assert.equal(email, " Admin@Example.com ");
        return {
          userId: "authoritative-user",
          selectedWorkspaceId: "workspace-1",
          email: "admin@example.com",
          locale: "en",
          createdAt: "2026-07-11T00:00:00.000Z",
          preferences: {
            reviewReactionAnimationsEnabled: true,
          },
        };
      },
      hasActiveAdminGrantFn: async (email): Promise<boolean> => {
        assert.equal(email, "admin@example.com");
        return true;
      },
      loadAdminProfileEmailFn: async () => {
        throw new Error("loadAdminProfileEmailFn should not run for session transport");
      },
    },
  );

  assert.equal(result.email, "admin@example.com");
  assert.equal(result.transport, "session");
  assert.equal(result.userId, "authoritative-user");
  assert.equal(result.subjectUserId, "subject-1");
});

test("requireCatalogAdminRequestWithDependencies preserves CSRF enforcement for session mutations", async () => {
  await assert.rejects(
    requireCatalogAdminRequestWithDependencies(
      new Request("https://api.flashcards-open-source-app.com/admin/catalog/packages", { method: "POST" }),
      ["https://flashcards-open-source-app.com"],
      {
        authenticateRequestFn: async (): Promise<AuthResult> => (
          createAuthenticatedResult("session", "admin@example.com")
        ),
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run before CSRF enforcement");
        },
        hasActiveAdminGrantFn: async () => {
          throw new Error("hasActiveAdminGrantFn should not run before CSRF enforcement");
        },
        loadAdminProfileEmailFn: async () => {
          throw new Error("loadAdminProfileEmailFn should not run for session transport");
        },
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 403
      && error.message === "Missing Origin or Referer header"
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
      ensureCognitoUserProfileFn: async () => {
        throw new Error("ensureCognitoUserProfileFn should not run for local auth");
      },
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
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run for local auth");
        },
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
        ensureCognitoUserProfileFn: async () => {
          throw new Error("ensureCognitoUserProfileFn should not run without an admin grant");
        },
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
  const auth = {
    ...createAuthenticatedResult("session", "Admin@Example.com "),
    userId: "stale-user",
  } satisfies AuthResult;
  const result = await requireAdminRequestWithDependencies(
    createRequest("http://localhost/admin/session"),
    [],
    {
      authenticateRequestFn: async (): Promise<AuthResult> => auth,
      ensureCognitoUserProfileFn: async (subjectUserId, email) => {
        assert.equal(subjectUserId, "subject-1");
        assert.equal(email, "Admin@Example.com ");
        return {
          userId: "authoritative-user",
          selectedWorkspaceId: "workspace-1",
          email: "admin@example.com",
          locale: "en",
          createdAt: "2026-07-11T00:00:00.000Z",
          preferences: {
            reviewReactionAnimationsEnabled: true,
          },
        };
      },
      hasActiveAdminGrantFn: async (): Promise<boolean> => true,
    },
  );

  assert.deepEqual(result, {
    email: "admin@example.com",
    transport: "session",
    userId: "authoritative-user",
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
