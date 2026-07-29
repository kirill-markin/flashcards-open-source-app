import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  createAgentInstructions,
  getHttpErrorResponseHeaders,
} from "./app";
import {
  authVerificationRetryAfterSeconds,
  authVerificationTemporarilyUnavailableCode,
} from "../auth";
import { resetAuthConfigForTests } from "../auth/config";
import { HttpError } from "../shared/errors";
import { resetGuestAiQuotaConfigForTests } from "../guestAiQuota/config";
import { MediaBlobLifecycleBusyError } from "../mediaAssets/blobLifecycle";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;
const originalBackendAllowedOrigins = process.env.BACKEND_ALLOWED_ORIGINS;
const originalPublicSiteBaseUrl = process.env.PUBLIC_SITE_BASE_URL;

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
}

function parseCommaSeparatedHeader(value: string): ReadonlyArray<string> {
  return value.split(",").map((item) => item.trim().toLowerCase()).filter((item) => item !== "");
}

test.afterEach(() => {
  restoreBackendAppTestEnvironment();
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();
});

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
    createAgentInstructions("SERVICE_UNAVAILABLE", 503),
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
      createAgentInstructions(code, statusCode),
      "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.",
    );
  }
});

test("createAgentInstructions retries blocked multipart session creation unchanged", () => {
  for (const code of [
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
  ] as const) {
    assert.equal(
      createAgentInstructions(code, 503),
      "Wait for the Retry-After delay, then retry the unchanged session creation request. Do not start a parallel byte upload.",
    );
  }
});

test("createAgentInstructions tells agents to retry temporary auth verification failures", () => {
  assert.equal(
    createAgentInstructions(authVerificationTemporarilyUnavailableCode, 503),
    "Retry the same authenticated request after the Retry-After delay without changing the token. If it keeps failing, sign in again and use requestId when debugging.",
  );
});

test("createAgentInstructions tells API-key agents to verify unknown commit outcomes before retrying", () => {
  assert.equal(
    createAgentInstructions("DATABASE_COMMIT_OUTCOME_UNKNOWN", 500),
    "Do not blindly replay the same request. Reload and check the current state first, then retry only if the requested change is confirmed absent. Use requestId when debugging.",
  );
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

test("app public catalog CORS allows website reads without credentialed backend access", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  process.env.BACKEND_ALLOWED_ORIGINS = "https://app.flashcards-open-source-app.com";
  process.env.PUBLIC_SITE_BASE_URL = "https://flashcards-open-source-app.com";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  const catalogResponse = await app.request("https://api.flashcards-open-source-app.com/v1/catalog/packages", {
    method: "OPTIONS",
    headers: {
      origin: "https://flashcards-open-source-app.com",
      "access-control-request-method": "GET",
      "access-control-request-headers": "sentry-trace,x-client-version",
    },
  });
  const accountResponse = await app.request("https://api.flashcards-open-source-app.com/v1/agent/me", {
    method: "OPTIONS",
    headers: {
      origin: "https://flashcards-open-source-app.com",
      "access-control-request-method": "GET",
    },
  });

  assert.equal(catalogResponse.status, 204);
  assert.equal(catalogResponse.headers.get("access-control-allow-origin"), "https://flashcards-open-source-app.com");
  assert.equal(catalogResponse.headers.get("access-control-allow-credentials"), null);
  assert.equal(catalogResponse.headers.get("access-control-allow-methods"), "GET,OPTIONS");
  assert.equal(accountResponse.status, 204);
  assert.equal(accountResponse.headers.get("access-control-allow-origin"), null);
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
