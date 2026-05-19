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
} from "./auth";
import { resetAuthConfigForTests } from "./authConfig";
import { HttpError } from "./errors";
import { resetGuestAiQuotaConfigForTests } from "./guestAiQuotaConfig";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;
const originalBackendAllowedOrigins = process.env.BACKEND_ALLOWED_ORIGINS;

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

test("createAgentInstructions tells API-key agents to honor Retry-After on service unavailable", () => {
  assert.equal(
    createAgentInstructions("SERVICE_UNAVAILABLE", 503),
    "Retry the same request after the Retry-After delay. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.",
  );
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
