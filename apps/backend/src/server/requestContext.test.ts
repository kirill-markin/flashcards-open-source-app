import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../shared/errors";
import {
  loadRequestContextWithAbortSignalAndDependencies,
} from "./requestContext";

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
