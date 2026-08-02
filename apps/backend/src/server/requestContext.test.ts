import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../shared/errors";
import {
  loadRequestContextWithAbortSignalAndDependencies,
  parseOptionalWorkspaceIdParam,
  parseWorkspaceIdParam,
} from "./requestContext";

const legacyWorkspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";
const versionFourWorkspaceId = "11111111-1111-4111-8111-111111111111";

test("workspace request parameters accept PostgreSQL UUID text", () => {
  for (const parseWorkspaceId of [
    parseWorkspaceIdParam,
    parseOptionalWorkspaceIdParam,
  ]) {
    assert.equal(parseWorkspaceId(legacyWorkspaceId), legacyWorkspaceId);
    assert.equal(parseWorkspaceId(versionFourWorkspaceId), versionFourWorkspaceId);
    assert.equal(
      parseWorkspaceId(` \n${legacyWorkspaceId}\t`),
      legacyWorkspaceId,
    );
  }

  assert.equal(parseOptionalWorkspaceIdParam(undefined), undefined);
});

test("required workspace request parameters preserve missing and invalid error codes", () => {
  assert.throws(
    () => parseWorkspaceIdParam(undefined),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "workspaceId is required");
      assert.equal(error.code, "WORKSPACE_ID_REQUIRED");
      return true;
    },
  );

  const invalidWorkspaceIds: ReadonlyArray<Readonly<{
    value: string;
    message: string;
  }>> = [
    { value: "", message: "workspaceId must not be empty" },
    { value: " \t\n", message: "workspaceId must not be empty" },
    {
      value: "35274129-ef97-d366-954c-955b4bb0fbf",
      message: "workspaceId must be a UUID",
    },
    {
      value: "g5274129-ef97-d366-954c-955b4bb0fbf0",
      message: "workspaceId must be a UUID",
    },
  ];

  for (const parseWorkspaceId of [
    parseWorkspaceIdParam,
    parseOptionalWorkspaceIdParam,
  ]) {
    for (const invalidWorkspaceId of invalidWorkspaceIds) {
      assert.throws(
        () => parseWorkspaceId(invalidWorkspaceId.value),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 400);
          assert.equal(error.message, invalidWorkspaceId.message);
          assert.equal(error.code, "WORKSPACE_ID_INVALID");
          return true;
        },
      );
    }
  }
});

test("request context aborts in-flight authentication before profile database work", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Media image ingestion cannot safely finish within its request deadline.",
    "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  let authenticationStarted = false;
  let deletedSubjectCalls = 0;
  let ensureCognitoProfileCalls = 0;
  let ensureProfileCalls = 0;
  let acquisitionCalls = 0;
  const preparation = (async () => {
    await loadRequestContextWithAbortSignalAndDependencies(
      {
        authorizationHeader: "Bearer pending-token",
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      controller.signal,
      {
        authenticateRequestWithAbortSignalFn: async (
          _request,
          abortSignal,
        ) => {
          authenticationStarted = true;
          return new Promise((_resolve, reject) => {
            const rejectAborted = (): void => reject(abortSignal.reason);
            abortSignal.addEventListener("abort", rejectAborted, { once: true });
            if (abortSignal.aborted) rejectAborted();
          });
        },
        isDeletedSubjectFn: async () => {
          deletedSubjectCalls += 1;
          return false;
        },
        ensureCognitoUserProfileFn: async () => {
          ensureCognitoProfileCalls += 1;
          throw new Error("Unexpected Cognito profile work.");
        },
        ensureUserProfileFn: async () => {
          ensureProfileCalls += 1;
          throw new Error("Unexpected profile work.");
        },
      },
    );
    acquisitionCalls += 1;
  })();

  assert.equal(authenticationStarted, true);
  controller.abort(deadlineError);
  await assert.rejects(preparation, (error: unknown) => {
    assert.equal(error, deadlineError);
    return true;
  });
  assert.equal(deletedSubjectCalls, 0);
  assert.equal(ensureCognitoProfileCalls, 0);
  assert.equal(ensureProfileCalls, 0);
  assert.equal(acquisitionCalls, 0);
});
