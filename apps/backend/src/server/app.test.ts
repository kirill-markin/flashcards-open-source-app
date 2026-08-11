import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  createAgentInstructions,
  createPublicHttpErrorBody,
  getHttpErrorResponseHeaders,
} from "./app";
import {
  authVerificationRetryAfterSeconds,
  authVerificationTemporarilyUnavailableCode,
} from "../auth";
import { resetAuthConfigForTests } from "../auth/config";
import { HttpError } from "../shared/errors";
import {
  getPublicAppBaseUrl,
  parsePublicOrigin,
} from "../shared/publicUrls";
import { resetGuestAiQuotaConfigForTests } from "../guestAiQuota/config";
import { MediaBlobLifecycleBusyError } from "../mediaAssets/blobLifecycle";
import { createAgentApiKeyErrorEnvelope } from "../agent/envelope";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;
const originalBackendAllowedOrigins = process.env.BACKEND_ALLOWED_ORIGINS;
const originalPublicSiteBaseUrl = process.env.PUBLIC_SITE_BASE_URL;
const originalPublicAppBaseUrl = process.env.PUBLIC_APP_BASE_URL;
const testAgentRequestUrl =
  "https://api.flashcards-open-source-app.com/v1/agent/sql/query";
const testMultipartCompletionRequestUrl =
  "https://api.flashcards-open-source-app.com/v1/workspaces/22222222-2222-4222-8222-222222222222/media-assets/upload-sessions/33333333-3333-4333-8333-333333333333/complete";
const testMultipartAbortRequestUrl =
  "https://api.flashcards-open-source-app.com/v1/workspaces/22222222-2222-4222-8222-222222222222/media-assets/upload-sessions/33333333-3333-4333-8333-333333333333/abort";
const testMultipartCreateRequestUrl =
  "https://api.flashcards-open-source-app.com/v1/workspaces/22222222-2222-4222-8222-222222222222/media-assets/upload-sessions";

function restoreBackendAppTestEnvironment(): void {
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

  if (originalBackendAllowedOrigins === undefined) {
    delete process.env.BACKEND_ALLOWED_ORIGINS;
  } else {
    process.env.BACKEND_ALLOWED_ORIGINS = originalBackendAllowedOrigins;
  }

  if (originalPublicSiteBaseUrl === undefined) {
    delete process.env.PUBLIC_SITE_BASE_URL;
  } else {
    process.env.PUBLIC_SITE_BASE_URL = originalPublicSiteBaseUrl;
  }

  if (originalPublicAppBaseUrl === undefined) {
    delete process.env.PUBLIC_APP_BASE_URL;
  } else {
    process.env.PUBLIC_APP_BASE_URL = originalPublicAppBaseUrl;
  }
}

function parseCommaSeparatedHeader(value: string): ReadonlyArray<string> {
  return value.split(",").map((item) => item.trim().toLowerCase()).filter((item) => item !== "");
}

test.afterEach(() => {
  restoreBackendAppTestEnvironment();
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();
});

test("public origin parsing rejects raw controls and backslashes and accepts IPv6", () => {
  for (const value of [
    "https://exa\nmple.com",
    "https://exa\u0085mple.com",
    "https://example.com\\",
  ] as const) {
    assert.throws(
      () => parsePublicOrigin(value, "PUBLIC_SITE_BASE_URL"),
      /without control characters or backslashes/,
    );
  }
  assert.equal(
    parsePublicOrigin("https://[2001:db8::1]", "PUBLIC_SITE_BASE_URL"),
    "https://[2001:db8::1]",
  );
});

test("public origin parsing rejects non-canonical raw representations", () => {
  for (const value of [
    " https://example.com",
    "https://example.com ",
    "https://example.com/",
    "HTTPS://EXAMPLE.COM",
    "https://example.com:443",
    "https://example.com:",
    "https://example.com:0443",
    "https://%65xample.com",
  ] as const) {
    assert.throws(
      () => parsePublicOrigin(value, "PUBLIC_SITE_BASE_URL"),
      /must be an absolute HTTP or HTTPS origin/,
    );
  }
});

test("public origin parsing rejects literal and encoded wildcard hosts", () => {
  for (const value of [
    "https://*.example.com",
    "https://*",
    "https://%2a.example.com",
    "https://%2A",
  ] as const) {
    assert.throws(
      () => parsePublicOrigin(value, "PUBLIC_SITE_BASE_URL"),
      /absolute HTTP or HTTPS origin/,
    );
  }
});

test("public origin parsing rejects raw authority userinfo including empty credentials", () => {
  for (const value of [
    "https://user@example.com",
    "https://@example.com",
    "https://:@example.com",
  ] as const) {
    assert.throws(
      () => parsePublicOrigin(value, "PUBLIC_SITE_BASE_URL"),
      /without credentials/,
    );
  }
});

test("configured public origins allow only the fixed localhost development origin", () => {
  assert.equal(
    parsePublicOrigin("http://localhost:3000", "PUBLIC_APP_BASE_URL"),
    "http://localhost:3000",
  );
  assert.equal(
    parsePublicOrigin("https://192.0.2.1", "PUBLIC_APP_BASE_URL"),
    "https://192.0.2.1",
  );
  for (const value of [
    "http://localhost:3001",
    "https://localhost:3000",
    "http://app.localhost:3000",
    "http://127.0.0.1:3000",
    "http://127.1:3000",
    "http://2130706433:3000",
    "http://0x7f000001:3000",
    "http://[::1]:3000",
    "http://[0:0:0:0:0:0:0:1]:3000",
    "http://[::ffff:127.0.0.1]:3000",
    "HTTP://LOCALHOST:3000",
    "http://localhost:03000",
    "http://%6cocalhost:3000",
  ] as const) {
    assert.throws(
      () => parsePublicOrigin(value, "PUBLIC_APP_BASE_URL"),
      /local or loopback origin must be exactly http:\/\/localhost:3000/,
    );
  }
});

test("app startup requires an explicit public app origin outside local development", () => {
  process.env.AUTH_MODE = "cognito";
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  delete process.env.PUBLIC_APP_BASE_URL;
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  assert.throws(
    () => createApp("/v1"),
    /PUBLIC_APP_BASE_URL is required outside explicit local development/,
  );
});

test("explicit local development uses only fixed localhost app origins", () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  delete process.env.PUBLIC_APP_BASE_URL;
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  assert.doesNotThrow(() => createApp("/v1"));
  assert.equal(
    getPublicAppBaseUrl("http://localhost:8080/v1/catalog"),
    "http://localhost:3000",
  );
  assert.equal(
    getPublicAppBaseUrl("http://127.0.0.1:8080/v1/catalog"),
    "http://localhost:3000",
  );
  assert.throws(
    () => getPublicAppBaseUrl("https://api.untrusted.example/v1/catalog"),
    /PUBLIC_APP_BASE_URL is required for non-local public catalog requests/,
  );
});

const invalidPublicAppOrigins = [
  " https://app.example.com",
  "https://app.example.com/",
  "HTTPS://APP.EXAMPLE.COM",
  "https://app.example.com:443",
  "https://app.example.com:",
  "https://app.example.com/catalog",
  "https://app.example.com/a/..",
  "https://app.example.com/%2e",
  "https://app.example.com/?",
] as const;

for (const publicAppBaseUrl of invalidPublicAppOrigins) {
  test(`app startup rejects invalid public app origin ${publicAppBaseUrl}`, () => {
    process.env.AUTH_MODE = "none";
    process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
    process.env.PUBLIC_APP_BASE_URL = publicAppBaseUrl;
    resetAuthConfigForTests();
    resetGuestAiQuotaConfigForTests();

    assert.throws(
      () => createApp("/v1"),
      /PUBLIC_APP_BASE_URL must be an absolute HTTP or HTTPS origin/,
    );
  });
}

const invalidPublicSiteOrigins = [
  "*",
  " https://flashcards-open-source-app.com",
  "https://flashcards-open-source-app.com/",
  "HTTPS://FLASHCARDS-OPEN-SOURCE-APP.COM",
  "https://flashcards-open-source-app.com:443",
  "https://flashcards-open-source-app.com:",
  "flashcards-open-source-app.com",
  "ftp://flashcards-open-source-app.com",
  "https://user:password@flashcards-open-source-app.com",
  "https://flashcards-open-source-app.com/catalog",
  "https://flashcards-open-source-app.com?source=catalog",
  "https://flashcards-open-source-app.com#catalog",
  "https://flashcards-open-source-app.com/a/..",
  "https://flashcards-open-source-app.com/%2e",
  "https://flashcards-open-source-app.com/?",
] as const;

for (const publicSiteBaseUrl of invalidPublicSiteOrigins) {
  test(`app startup rejects invalid public site origin ${publicSiteBaseUrl}`, () => {
    process.env.AUTH_MODE = "none";
    process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
    process.env.PUBLIC_SITE_BASE_URL = publicSiteBaseUrl;
    resetAuthConfigForTests();
    resetGuestAiQuotaConfigForTests();

    assert.throws(
      () => createApp("/v1"),
      /PUBLIC_SITE_BASE_URL must be an absolute HTTP or HTTPS origin/,
    );
  });
}

test("getHttpErrorResponseHeaders adds Retry-After for service unavailable", () => {
  assert.deepEqual(
    getHttpErrorResponseHeaders(
      new HttpError(
        503,
        "Service is temporarily unavailable. Retry shortly.",
        "SERVICE_UNAVAILABLE",
      ),
    ),
    [["Retry-After", "1"]],
  );
});

test("public HTTP error boundary sanitizes catalog blob diagnostics", () => {
  const sha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
  const storageKey = `media/blobs/sha256/5e/88/${sha256}`;
  const requestId = "request-catalog-image-1";
  const fixtures = [
    {
      statusCode: 409,
      code: "CATALOG_IMAGE_BLOB_OBJECT_MISMATCH",
      internalMessage:
        `Catalog image blob conflict. sha256=${sha256} storageKey=${storageKey}`,
      details: {
        reason: "stored_object_mismatch" as const,
        sha256,
        storageKey,
        mismatchedFields: ["sha256"],
      },
      publicMessage:
        "Catalog image storage conflict. Upload the image again and use requestId if the failure persists.",
    },
    {
      statusCode: 503,
      code: "CATALOG_IMAGE_BLOB_STORAGE_UNAVAILABLE",
      internalMessage:
        `Catalog image storage failed for s3://private-bucket/${storageKey}. raw S3 body`,
      details: {
        reason: "storage_temporarily_unavailable" as const,
        sha256,
        storageKey,
        s3StatusCode: 500,
        s3ErrorClass: "InternalError",
        s3ErrorMessage: "raw S3 body",
      },
      publicMessage:
        "Catalog image storage is temporarily unavailable. Retry shortly and use requestId if the failure persists.",
    },
  ];

  for (const fixture of fixtures) {
    const error = new HttpError(
      fixture.statusCode,
      fixture.internalMessage,
      fixture.code,
      { catalogImageBlob: fixture.details },
    );
    const body = createPublicHttpErrorBody(error, requestId);
    const serializedBody = JSON.stringify(body);

    assert.equal(error.message, fixture.internalMessage);
    assert.deepEqual(body, {
      error: fixture.publicMessage,
      requestId,
      code: fixture.code,
    });
    for (const privateDiagnostic of [
      sha256,
      storageKey,
      "private-bucket",
      "InternalError",
      "raw S3 body",
    ]) {
      assert.equal(serializedBody.includes(privateDiagnostic), false);
    }
  }
});

test("getHttpErrorResponseHeaders adds Retry-After for temporary auth verification failures", () => {
  assert.deepEqual(
    getHttpErrorResponseHeaders(
      new HttpError(
        503,
        "Authentication verification is temporarily unavailable. Retry shortly.",
        authVerificationTemporarilyUnavailableCode,
      ),
    ),
    [["Retry-After", authVerificationRetryAfterSeconds.toString()]],
  );
});

test("getHttpErrorResponseHeaders carries bounded writer and deadline retry guidance", () => {
  for (const [statusCode, code, retryAfterSeconds] of [
    [409, "MEDIA_ASSET_WRITER_BUSY", 7],
    [503, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED", 1],
    [503, "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED", 1],
    [503, "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS", 1],
    [409, "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS", 1],
    [503, "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS", 7],
  ] as const) {
    assert.deepEqual(
      getHttpErrorResponseHeaders(
        new HttpError(
          statusCode,
          "Retry this request.",
          code,
          { retryAfterSeconds },
        ),
      ),
      [["Retry-After", retryAfterSeconds.toString()]],
    );
  }
});

test("getHttpErrorResponseHeaders carries centralized lifecycle busy retry guidance", () => {
  const error = new MediaBlobLifecycleBusyError();

  assert.equal(error.details?.retryAfterSeconds, 1);
  assert.deepEqual(
    getHttpErrorResponseHeaders(error),
    [["Retry-After", "1"]],
  );
});

test("createAgentInstructions tells API-key agents to honor Retry-After on service unavailable", () => {
  assert.equal(
    createAgentInstructions(
      "SERVICE_UNAVAILABLE",
      503,
      testAgentRequestUrl,
    ),
    "Retry the same request after the Retry-After delay. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.",
  );
});

test("createAgentInstructions retries transient direct ingestion requests unchanged", () => {
  for (const [code, statusCode] of [
    ["MEDIA_BLOB_LIFECYCLE_BUSY", 503],
    ["MEDIA_ASSET_WRITER_BUSY", 409],
    ["MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED", 503],
  ] as const) {
    assert.equal(
      createAgentInstructions(code, statusCode, testAgentRequestUrl),
      "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.",
    );
  }
});

test("createAgentInstructions preserves durable multipart completion recovery", () => {
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
      503,
      testMultipartCompletionRequestUrl,
    ),
    "Wait for the Retry-After delay, then retry the same completion with the unchanged session and parts. Do not abort the session or create a replacement upload.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
      503,
      testMultipartCompletionRequestUrl,
    ),
    "Completion has a live writer or was accepted for durable processing. Wait for Retry-After, then retry the unchanged completion with the same session and parts; do not abort or replace the upload.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
      409,
      testMultipartCompletionRequestUrl,
    ),
    "Expiry cleanup was denied because completion is being durably reconciled; abort admission made no database or S3 mutation. Wait for Retry-After, then retry the unchanged completion with the same session and parts.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
      409,
      testMultipartAbortRequestUrl,
    ),
    "Abort admission was denied and this abort made no database or S3 mutation. Wait for Retry-After, then retry completion or session creation to observe the durable outcome; do not start a replacement byte upload or retry abort while completion remains active.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
      409,
      testMultipartCompletionRequestUrl,
    ),
    "This expired upload session has already been closed. Create a fresh multipart upload session, upload the bytes again, and complete the new session; do not retry this completion request.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
      409,
      testMultipartCompletionRequestUrl,
    ),
    "This legacy upload session cannot complete durably. Abort it if it is still open, then create a fresh multipart upload session, upload the bytes again, and complete the new session.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
      409,
      testMultipartCompletionRequestUrl,
    ),
    "Completion already won for this upload session. Reload and use the completed media asset, or replay the original completion only to retrieve its idempotent result. Do not retry abort or create a replacement upload.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
      409,
      testMultipartCompletionRequestUrl,
    ),
    "Reload the upload session and media asset to determine their canonical state before choosing the next action. Do not blindly replay completion or abort, and do not assume earlier storage work was rolled back.",
  );
  for (const code of [
    "MEDIA_ASSET_UPLOAD_MISMATCH",
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
  ]) {
    assert.equal(
      createAgentInstructions(
        code,
        409,
        testMultipartCompletionRequestUrl,
      ),
      "Reload the upload session and media asset before taking another action. Do not blindly replay the mismatched completion or assume rollback; if no completed asset exists, close the stale session as allowed and create a fresh upload with the correct bytes and metadata.",
    );
  }
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_NOT_FOUND",
      409,
      testMultipartCompletionRequestUrl,
    ),
    "Reload the upload session and media asset before taking another action. Do not blindly replay or assume rollback; if no completion is pending or applied, create a fresh upload session and upload the bytes again.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
      403,
      testMultipartCompletionRequestUrl,
    ),
    "Reload account, workspace access, upload-session, and media-asset state. Do not retry completion until access is restored, and do not assume earlier storage work was rolled back.",
  );
  assert.match(
    createAgentInstructions(
      "WORKSPACE_ACCESS_DENIED",
      403,
      testMultipartCompletionRequestUrl,
    ),
    /Completion may have performed storage work.*do not assume rollback/,
  );
  assert.match(
    createAgentInstructions(
      "WORKSPACE_ACCESS_DENIED",
      403,
      testMultipartAbortRequestUrl,
    ),
    /before abort admission or after admitted S3 work.*do not assume rollback/,
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_REPLICA_INVALID",
      400,
      testMultipartCompletionRequestUrl,
    ),
    "Reload the workspace replicas, upload session, and media asset before retrying with a currently accessible lastModifiedByReplicaId. Do not assume earlier storage work was rolled back.",
  );
  assert.equal(
    createAgentInstructions(
      "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
      503,
      testMultipartCreateRequestUrl,
    ),
    "Wait for the Retry-After delay, then retry the unchanged session creation request. Do not start a parallel byte upload.",
  );
});

test("createAgentInstructions tells agents to retry temporary auth verification failures", () => {
  assert.equal(
    createAgentInstructions(
      authVerificationTemporarilyUnavailableCode,
      503,
      testAgentRequestUrl,
    ),
    "Retry the same authenticated request after the Retry-After delay without changing the token. If it keeps failing, sign in again and use requestId when debugging.",
  );
});

test("createAgentInstructions tells API-key agents to verify unknown commit outcomes before retrying", () => {
  assert.equal(
    createAgentInstructions(
      "DATABASE_COMMIT_OUTCOME_UNKNOWN",
      500,
      testAgentRequestUrl,
    ),
    "Do not blindly replay the same request. Reload and check the current state first, then retry only if the requested change is confirmed absent. Use requestId when debugging.",
  );
});

test("multipart completion and abort envelopes preserve action-specific recovery", () => {
  const createEnvelope = (
    requestUrl: string,
    code: string,
    statusCode: number,
  ) => createAgentApiKeyErrorEnvelope(
    requestUrl,
    code,
    "Test multipart failure.",
    statusCode,
    "request-1",
    undefined,
  );

  for (const code of [
    "MEDIA_ASSET_STORAGE_UNAVAILABLE",
    "MEDIA_BLOB_LIFECYCLE_BUSY",
    "SERVICE_UNAVAILABLE",
  ]) {
    const completion = createEnvelope(
      testMultipartCompletionRequestUrl,
      code,
      503,
    );
    const abort = createEnvelope(
      testMultipartAbortRequestUrl,
      code,
      503,
    );
    assert.match(completion.instructions, /completion|Completion/);
    assert.match(completion.instructions, /not assume rollback|unknown storage/);
    assert.match(abort.instructions, /abort|Abort/);
    assert.match(abort.instructions, /not assume rollback|S3 abort completed/);
    assert.equal(completion.error.code, code);
    assert.equal(abort.error.code, code);
  }

  const completionPending = createEnvelope(
    testMultipartCompletionRequestUrl,
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    409,
  );
  const abortPending = createEnvelope(
    testMultipartAbortRequestUrl,
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    409,
  );
  assert.match(completionPending.instructions, /Expiry cleanup/);
  assert.doesNotMatch(completionPending.instructions, /This abort/);
  assert.match(abortPending.instructions, /this abort made no database or S3 mutation/);

  for (const requestUrl of [
    testMultipartCompletionRequestUrl,
    testMultipartAbortRequestUrl,
  ]) {
    const unknown = createEnvelope(
      requestUrl,
      "DATABASE_COMMIT_OUTCOME_UNKNOWN",
      500,
    );
    const notFound = createEnvelope(
      requestUrl,
      "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
      404,
    );
    assert.match(unknown.instructions, /outcome is unknown/);
    assert.match(unknown.instructions, /rollback is not guaranteed/);
    assert.match(notFound.instructions, /Reload canonical/);
    assert.match(notFound.instructions, /sessionId/);
  }
});

test("app error handler returns Retry-After for service unavailable responses", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  app.get("/transient-database-error", () => {
    throw new HttpError(
      503,
      "Service is temporarily unavailable. Retry shortly.",
      "SERVICE_UNAVAILABLE",
    );
  });

  const response = await app.request("http://localhost/v1/transient-database-error");
  const payload = await response.json() as Readonly<{
    error: string;
    code: string | null;
    requestId: string;
  }>;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(payload.error, "Service is temporarily unavailable. Retry shortly.");
  assert.equal(payload.code, "SERVICE_UNAVAILABLE");
  assert.notEqual(payload.requestId, "");
});

test("app error handler returns Retry-After for temporary auth verification failures", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  app.get("/auth-verification-temporary-error", () => {
    throw new HttpError(
      503,
      "Authentication verification is temporarily unavailable. Retry shortly.",
      authVerificationTemporarilyUnavailableCode,
    );
  });

  const response = await app.request("http://localhost/v1/auth-verification-temporary-error");
  const payload = await response.json() as Readonly<{
    error: string;
    code: string | null;
    requestId: string;
  }>;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), authVerificationRetryAfterSeconds.toString());
  assert.equal(payload.error, "Authentication verification is temporarily unavailable. Retry shortly.");
  assert.equal(payload.code, authVerificationTemporarilyUnavailableCode);
  assert.notEqual(payload.requestId, "");
});

test("app browser CORS preflight allows chat metadata headers", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  process.env.BACKEND_ALLOWED_ORIGINS = "http://localhost:3000";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  const response = await app.request("http://localhost/v1/chat/runs", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "content-type,x-chat-request-id,x-chat-resume-attempt-id,x-client-platform,x-client-version",
    },
  });

  const allowHeaders = response.headers.get("access-control-allow-headers");
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.notEqual(allowHeaders, null);
  if (allowHeaders === null) {
    throw new Error("Expected access-control-allow-headers on browser preflight response.");
  }
  const parsedAllowHeaders = parseCommaSeparatedHeader(allowHeaders);
  assert.ok(parsedAllowHeaders.includes("x-chat-request-id"));
  assert.ok(parsedAllowHeaders.includes("x-chat-resume-attempt-id"));
  assert.ok(parsedAllowHeaders.includes("x-client-platform"));
  assert.ok(parsedAllowHeaders.includes("x-client-version"));
});

test("app public catalog CORS allows production site, app, and local reads without credentials", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  process.env.BACKEND_ALLOWED_ORIGINS = "https://app.flashcards-open-source-app.com";
  process.env.PUBLIC_SITE_BASE_URL = "https://flashcards-open-source-app.com";
  process.env.PUBLIC_APP_BASE_URL = "https://app.flashcards-open-source-app.com";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  const requestCatalogPreflight = async (origin: string): Promise<Response> => (
    app.request("https://api.flashcards-open-source-app.com/v1/catalog", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "sentry-trace,x-client-version",
      },
    })
  );
  const siteResponse = await requestCatalogPreflight("https://flashcards-open-source-app.com");
  const appResponse = await requestCatalogPreflight("https://app.flashcards-open-source-app.com");
  const localResponse = await requestCatalogPreflight("http://localhost:3000");
  const unrelatedResponse = await requestCatalogPreflight("https://unrelated.example.com");
  const appGetResponse = await app.request(
    "https://api.flashcards-open-source-app.com/v1/catalog/package-versions/not-a-uuid/cards",
    { headers: { origin: "https://app.flashcards-open-source-app.com" } },
  );
  const accountResponse = await app.request("https://api.flashcards-open-source-app.com/v1/agent/me", {
    method: "OPTIONS",
    headers: {
      origin: "https://flashcards-open-source-app.com",
      "access-control-request-method": "GET",
    },
  });

  assert.equal(siteResponse.status, 204);
  assert.equal(siteResponse.headers.get("access-control-allow-origin"), "https://flashcards-open-source-app.com");
  assert.equal(appResponse.status, 204);
  assert.equal(appResponse.headers.get("access-control-allow-origin"), "https://app.flashcards-open-source-app.com");
  assert.equal(appResponse.headers.get("access-control-allow-credentials"), null);
  assert.equal(appResponse.headers.get("access-control-allow-methods"), "GET,OPTIONS");
  assert.equal(localResponse.status, 204);
  assert.equal(localResponse.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.equal(unrelatedResponse.status, 204);
  assert.equal(unrelatedResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(appGetResponse.status, 400);
  assert.equal(
    appGetResponse.headers.get("access-control-allow-origin"),
    "https://app.flashcards-open-source-app.com",
  );
  assert.equal(appGetResponse.headers.get("access-control-allow-credentials"), null);
  assert.equal(accountResponse.status, 204);
  assert.equal(accountResponse.headers.get("access-control-allow-origin"), null);
});

test("app public catalog CORS uses only fixed origins when local configuration is explicit", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  delete process.env.PUBLIC_SITE_BASE_URL;
  delete process.env.PUBLIC_APP_BASE_URL;
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  const requestPreflight = async (origin: string): Promise<Response> => app.request(
    "http://localhost:8080/v1/catalog",
    {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
      },
    },
  );
  const localResponse = await requestPreflight("http://localhost:3000");
  const adminLocalResponse = await requestPreflight("http://localhost:3001");
  const loopbackResponse = await requestPreflight("http://127.0.0.1:3000");
  const unrelatedResponse = await requestPreflight("https://untrusted.example");

  assert.equal(localResponse.status, 204);
  assert.equal(localResponse.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.equal(localResponse.headers.get("access-control-allow-credentials"), null);
  assert.equal(adminLocalResponse.status, 204);
  assert.equal(adminLocalResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(loopbackResponse.status, 204);
  assert.equal(loopbackResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(unrelatedResponse.status, 204);
  assert.equal(unrelatedResponse.headers.get("access-control-allow-origin"), null);
});

test("app public catalog CORS uses the configured self-hosted public app origin", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  process.env.PUBLIC_SITE_BASE_URL = "https://cards.example.test";
  process.env.PUBLIC_APP_BASE_URL = "https://study.cards.example.test";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  const appOriginResponse = await app.request("https://api.cards.example.test/v1/catalog", {
    method: "OPTIONS",
    headers: {
      origin: "https://study.cards.example.test",
      "access-control-request-method": "GET",
    },
  });
  const unrelatedResponse = await app.request("https://api.cards.example.test/v1/catalog", {
    method: "OPTIONS",
    headers: {
      origin: "https://other.cards.example.test",
      "access-control-request-method": "GET",
    },
  });
  const appGetResponse = await app.request(
    "https://api.cards.example.test/v1/catalog/package-versions/not-a-uuid/cards",
    { headers: { origin: "https://study.cards.example.test" } },
  );

  assert.equal(appOriginResponse.status, 204);
  assert.equal(
    appOriginResponse.headers.get("access-control-allow-origin"),
    "https://study.cards.example.test",
  );
  assert.equal(appOriginResponse.headers.get("access-control-allow-credentials"), null);
  assert.equal(unrelatedResponse.status, 204);
  assert.equal(unrelatedResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(appGetResponse.status, 400);
  assert.equal(
    appGetResponse.headers.get("access-control-allow-origin"),
    "https://study.cards.example.test",
  );
  assert.equal(appGetResponse.headers.get("access-control-allow-credentials"), null);
});

test("app public catalog errors keep the public envelope when an API key header is present", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  const response = await app.request("http://localhost/v1/catalog/package-versions/not-a-uuid/cards", {
    headers: {
      authorization: "ApiKey test-key",
    },
  });
  const payload = await response.json() as Readonly<{
    error: string;
    code: string | null;
    requestId: string;
    ok?: boolean;
    data?: unknown;
    instructions?: unknown;
    docs?: unknown;
  }>;

  assert.equal(response.status, 400);
  assert.equal(payload.error, "packageVersionId must be a UUID");
  assert.equal(payload.code, "CATALOG_PUBLIC_PARAM_INVALID");
  assert.notEqual(payload.requestId, "");
  assert.equal(payload.ok, undefined);
  assert.equal(payload.data, undefined);
  assert.equal(payload.instructions, undefined);
  assert.equal(payload.docs, undefined);
});
