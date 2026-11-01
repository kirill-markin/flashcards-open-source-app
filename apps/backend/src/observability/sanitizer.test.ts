import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeBackendTelemetryValue } from "./sanitizer";

test("backend sanitizer redacts secrets and keeps user content readable", () => {
  const sanitized = sanitizeBackendTelemetryValue({
    authorization: "Bearer token-value",
    cookie: "session=secret",
    csrfToken: "csrf-secret",
    apiKey: "sk_12345678901234567890",
    hasToken: true,
    base64Data: "aGVsbG8=",
    base64_data: "aGVsbG8=",
    frontText: "question text",
    turnInput: [{ type: "text", text: "user prompt" }],
    message: "provider text for user@example.com",
    tool_arguments: "{\"frontText\":\"question\"}",
    headers: { authorization: "Bearer token-value", "content-type": "application/json" },
    query: "token=secret&search=cards",
    queryString: "search=cards",
    input_tokens: 11,
    total_tokens: 25,
    requestUrl: "https://api.example.invalid/v1/cards?token=secret&query=cards",
    directApiKey: "OpenAI key sk-proj-123456789012345678901234",
    providerMessage: "OpenAI key sk-proj-123456789012345678901234 and legacy key sk-12345678901234567890",
    phoneText: "Call +14155552671 about card 1234567890123",
    requestId: "request-1",
  });

  assert.deepEqual(sanitized, {
    authorization: "<redacted-secret>",
    cookie: "<redacted-secret>",
    csrfToken: "<redacted-secret>",
    apiKey: "<redacted-secret>",
    hasToken: true,
    base64Data: "<redacted-base64>",
    base64_data: "<redacted-base64>",
    frontText: "question text",
    turnInput: [{ type: "text", text: "user prompt" }],
    message: "provider text for user@example.com",
    tool_arguments: "{\"frontText\":\"question\"}",
    headers: { authorization: "<redacted-secret>", "content-type": "application/json" },
    query: "<redacted-secret>",
    queryString: "search=cards",
    input_tokens: 11,
    total_tokens: 25,
    requestUrl: "https://api.example.invalid/v1/cards?<redacted-query>",
    directApiKey: "<redacted-secret>",
    providerMessage: "OpenAI key <masked-api-key> and legacy key <masked-api-key>",
    phoneText: "Call +14155552671 about card 1234567890123",
    requestId: "request-1",
  });
});

test("backend sanitizer redacts secrets inside serialized JSON container strings", () => {
  assert.equal(
    sanitizeBackendTelemetryValue(JSON.stringify({
      image_url: "data:image/png;base64,AAAA",
      prompt: "user prompt",
      nested: {
        sessionToken: "session-token-value",
        url: "data:image/png;base64,BBBB",
      },
    })),
    JSON.stringify({
      image_url: "<redacted-base64>",
      prompt: "user prompt",
      nested: {
        sessionToken: "<redacted-secret>",
        url: "<redacted-base64>",
      },
    }),
  );

  assert.equal(
    sanitizeBackendTelemetryValue("not json {\"token\":\"value\"}"),
    "not json {\"token\":\"value\"}",
  );
});

test("backend sanitizer redacts raw query strings only when a key is secret", () => {
  assert.equal(
    sanitizeBackendTelemetryValue("token=secret&search=cards"),
    "<redacted-secret>",
  );
  assert.equal(
    sanitizeBackendTelemetryValue("search=cards&userText=hello"),
    "search=cards&userText=hello",
  );
  assert.equal(
    sanitizeBackendTelemetryValue("input_tokens=12&output_tokens=10"),
    "input_tokens=12&output_tokens=10",
  );
});

test("backend sanitizer preserves unsupported values as undefined", () => {
  const sanitized = sanitizeBackendTelemetryValue({
    type: undefined,
    nested: {
      skipped: Symbol("unsupported"),
      callback: (): void => {},
    },
    array: [undefined, 1n],
  });

  assert.deepEqual(sanitized, {
    type: undefined,
    nested: {
      skipped: undefined,
      callback: undefined,
    },
    array: [undefined, undefined],
  });
});

test("backend sanitizer preserves operational token booleans", () => {
  assert.deepEqual(
    sanitizeBackendTelemetryValue({
      hasToken: false,
      input_tokens: 11,
      output_tokens: 12,
      prompt_tokens: 13,
      completion_tokens: 14,
      total_tokens: 25,
      token: "real-token-value",
      nested: {
        hasRefreshToken: true,
        tokenCount: 7,
        authorization: "Bearer real-token-value",
      },
    }),
    {
      hasToken: false,
      input_tokens: 11,
      output_tokens: 12,
      prompt_tokens: 13,
      completion_tokens: 14,
      total_tokens: 25,
      token: "<redacted-secret>",
      nested: {
        hasRefreshToken: true,
        tokenCount: 7,
        authorization: "<redacted-secret>",
      },
    },
  );
});
