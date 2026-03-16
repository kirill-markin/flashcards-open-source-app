import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../errors";
import { loadRequestContextWithDependencies, parseWorkspaceIdParam } from "./requestContext";

test("parseWorkspaceIdParam accepts UUID values", () => {
  assert.equal(
    parseWorkspaceIdParam("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000",
  );
});

test("parseWorkspaceIdParam rejects non-UUID values", () => {
  assert.throws(
    () => parseWorkspaceIdParam("not-a-uuid"),
    (error: unknown) => error instanceof HttpError
      && error.code === "WORKSPACE_ID_INVALID"
      && error.message === "workspaceId must be a UUID",
  );
});

test("loadRequestContextWithDependencies rejects deleted ApiKey users", async () => {
  await assert.rejects(
    () => loadRequestContextWithDependencies({
      authorizationHeader: "ApiKey test-key",
      sessionToken: undefined,
      csrfTokenHeader: undefined,
      originHeader: undefined,
      refererHeader: undefined,
      secFetchSiteHeader: undefined,
    }, {
      authenticateRequestFn: async () => ({
        userId: "user-1",
        email: "user@example.com",
        cognitoUsername: null,
        transport: "api_key",
        connectionId: "connection-1",
        selectedWorkspaceId: "workspace-1",
      }),
      isDeletedSubjectFn: async () => true,
      ensureUserProfileFn: async () => {
        throw new Error("Deleted ApiKey users must be rejected before profile loading");
      },
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 410
      && error.code === "ACCOUNT_DELETED"
      && error.message === "This account has already been deleted.",
  );
});

test("loadRequestContextWithDependencies keeps local auth available without deleted-subject checks", async () => {
  const requestContext = await loadRequestContextWithDependencies({
    authorizationHeader: undefined,
    sessionToken: undefined,
    csrfTokenHeader: undefined,
    originHeader: undefined,
    refererHeader: undefined,
    secFetchSiteHeader: undefined,
  }, {
    authenticateRequestFn: async () => ({
      userId: "local",
      email: null,
      cognitoUsername: null,
      transport: "none",
      connectionId: null,
      selectedWorkspaceId: null,
    }),
    isDeletedSubjectFn: async () => {
      throw new Error("Local auth should bypass deleted-subject checks");
    },
    ensureUserProfileFn: async () => ({
      userId: "local",
      selectedWorkspaceId: "workspace-local",
      email: null,
      locale: "en",
      createdAt: "2026-03-16T00:00:00.000Z",
    }),
  });

  assert.deepEqual(requestContext, {
    userId: "local",
    selectedWorkspaceId: "workspace-local",
    email: null,
    locale: "en",
    userSettingsCreatedAt: "2026-03-16T00:00:00.000Z",
    transport: "none",
    connectionId: null,
  });
});
