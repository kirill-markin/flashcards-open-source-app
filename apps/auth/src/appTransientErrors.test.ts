import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { resetDemoEmailAccessConfigForTests } from "./server/demoEmailAccess.js";

type ServiceUnavailableResponse = Readonly<{
  code: string;
  error: string;
  requestId: string;
}>;

type AgentServiceUnavailableResponse = Readonly<{
  ok: boolean;
  data: Record<string, never>;
  instructions: string;
  error?: Readonly<{
    code: string;
    message: string;
  }>;
}>;

type ErrorWithCode = Error & Readonly<{
  code: string;
}>;

const originalAllowedRedirectUris = process.env.ALLOWED_REDIRECT_URIS;
const serviceUnavailableMessage = "Service is temporarily unavailable. Retry shortly.";

function createErrorWithCode(message: string, code: string): ErrorWithCode {
  const error = new Error(message) as ErrorWithCode;
  Object.defineProperty(error, "code", {
    value: code,
    enumerable: true,
  });
  return error;
}

function restoreAllowedRedirectUris(): void {
  if (originalAllowedRedirectUris === undefined) {
    delete process.env.ALLOWED_REDIRECT_URIS;
    return;
  }

  process.env.ALLOWED_REDIRECT_URIS = originalAllowedRedirectUris;
}

test.afterEach(() => {
  restoreAllowedRedirectUris();
  resetDemoEmailAccessConfigForTests();
});

test("transient database errors return retryable 503 API responses", async () => {
  process.env.ALLOWED_REDIRECT_URIS = "https://app.flashcards-open-source-app.com";
  resetDemoEmailAccessConfigForTests();
  const app = createApp("/");

  app.get("/api/transient-database-error", () => {
    throw createErrorWithCode("terminating connection due to administrator command", "57P01");
  });

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/transient-database-error", {
    headers: {
      origin: "https://app.flashcards-open-source-app.com",
    },
  });
  const payload = await response.json() as ServiceUnavailableResponse;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("access-control-expose-headers"), "retry-after");
  assert.equal(payload.code, "SERVICE_UNAVAILABLE");
  assert.equal(payload.error, serviceUnavailableMessage);
  assert.notEqual(payload.requestId, "");
});

test("transient database errors return retryable 503 API responses for execute-api paths", async () => {
  const app = createApp("/");

  app.get("/v1/api/transient-database-error", () => {
    throw createErrorWithCode("terminating connection due to administrator command", "57P01");
  });

  const response = await app.request("https://execute-api.example.com/v1/api/transient-database-error");
  const payload = await response.json() as ServiceUnavailableResponse;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("access-control-expose-headers"), "retry-after");
  assert.equal(payload.code, "SERVICE_UNAVAILABLE");
  assert.equal(payload.error, serviceUnavailableMessage);
  assert.notEqual(payload.requestId, "");
});

test("transient database errors return agent envelopes for execute-api paths", async () => {
  const app = createApp("/");

  app.get("/v1/api/agent/transient-database-error", () => {
    throw createErrorWithCode("terminating connection due to administrator command", "57P01");
  });

  const response = await app.request("https://execute-api.example.com/v1/api/agent/transient-database-error");
  const payload = await response.json() as AgentServiceUnavailableResponse;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("access-control-expose-headers"), "retry-after");
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.code, "SERVICE_UNAVAILABLE");
  assert.equal(payload.error?.message, serviceUnavailableMessage);
  assert.equal(payload.instructions, "Retry the same action shortly.");
});
