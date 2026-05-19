import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeBackendTelemetryValue } from "./sanitizer";

test("backend sanitizer redacts secrets and user content", () => {
  const sanitized = sanitizeBackendTelemetryValue({
    authorization: "Bearer token-value",
    cookie: "session=secret",
    csrfToken: "csrf-secret",
    apiKey: "sk_12345678901234567890",
    hasToken: true,
    base64Data: "aGVsbG8=",
    base64_data: "aGVsbG8=",
    frontText: "question text",
    front_text: "question text",
    backText: "answer text",
    back_text: "answer text",
    turnInput: [{ type: "text", text: "private prompt" }],
    localMessages: [{ role: "user", content: "private message" }],
    local_messages: [{ role: "user", content: "private message" }],
    model_input: [{ role: "user", content: "private input" }],
    model_output: "private output",
    prompt: "private prompt",
    message: "private provider text",
    completion: "private completion",
    "gen_ai.prompt": "private gen ai prompt",
    "gen_ai.completion": "private gen ai completion",
    tool_arguments: "{\"frontText\":\"private question\"}",
    arguments: "{\"backText\":\"private answer\"}",
    headers: { authorization: "Bearer token-value" },
    query: "token=secret&search=private",
    query_string: "token=secret&search=private",
    queryString: "search=private",
    querystring: "userText=private",
    request: {
      query_string: "token=secret&query=private",
    },
    input_tokens: 11,
    output_tokens: 12,
    prompt_tokens: 13,
    completion_tokens: 14,
    total_tokens: 25,
    rawResponseBody: "model output",
    raw_response_body: "model output",
    requestUrl: "https://api.example.invalid/v1/cards?token=secret&query=private",
    directApiKey: "OpenAI key sk-proj-123456789012345678901234 and legacy key sk-12345678901234567890",
    providerMessage: "OpenAI key sk-proj-123456789012345678901234 and legacy key sk-12345678901234567890",
    sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-1",
    userId: "user-1",
    workspaceId: "workspace-1",
  });

  assert.deepEqual(sanitized, {
    authorization: "<redacted-secret>",
    cookie: "<redacted-secret>",
    csrfToken: "<redacted-secret>",
    apiKey: "<redacted-secret>",
    hasToken: true,
    base64Data: "<redacted-base64>",
    base64_data: "<redacted-base64>",
    frontText: "<redacted-content>",
    front_text: "<redacted-content>",
    backText: "<redacted-content>",
    back_text: "<redacted-content>",
    turnInput: "<redacted-content>",
    localMessages: "<redacted-content>",
    local_messages: "<redacted-content>",
    model_input: "<redacted-content>",
    model_output: "<redacted-content>",
    prompt: "<redacted-content>",
    message: "<redacted-content>",
    completion: "<redacted-content>",
    "gen_ai.prompt": "<redacted-content>",
    "gen_ai.completion": "<redacted-content>",
    tool_arguments: "<redacted-content>",
    arguments: "<redacted-content>",
    headers: "<redacted-content>",
    query: "<redacted-content>",
    query_string: "<redacted-content>",
    queryString: "<redacted-content>",
    querystring: "<redacted-content>",
    request: {
      query_string: "<redacted-content>",
    },
    input_tokens: 11,
    output_tokens: 12,
    prompt_tokens: 13,
    completion_tokens: 14,
    total_tokens: 25,
    rawResponseBody: "<redacted-content>",
    raw_response_body: "<redacted-content>",
    requestUrl: "https://api.example.invalid/v1/cards?<redacted-query>",
    directApiKey: "<redacted-secret>",
    providerMessage: "OpenAI key <masked-api-key> and legacy key <masked-api-key>",
    sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-1",
    userId: "user-1",
    workspaceId: "workspace-1",
  });
});

test("backend sanitizer redacts direct text content part arrays", () => {
  assert.deepEqual(
    sanitizeBackendTelemetryValue([{ type: "text", text: "private prompt" }]),
    [{ type: "text", text: "<redacted-content>" }],
  );
});

test("backend sanitizer redacts serialized JSON container strings", () => {
  assert.equal(
    sanitizeBackendTelemetryValue(JSON.stringify({
      image_url: "data:image/png;base64,AAAA",
      file_data: "raw file bytes",
      input: "private input",
      output: "private output",
      prompt: "private prompt",
      message: "private provider message",
      nested: {
        content: "private content",
        url: "data:image/png;base64,BBBB",
      },
      safeText: "contact user@example.com",
    })),
    JSON.stringify({
      image_url: "<redacted-content>",
      file_data: "<redacted-content>",
      input: "<redacted-content>",
      output: "<redacted-content>",
      prompt: "<redacted-content>",
      message: "<redacted-content>",
      nested: {
        content: "<redacted-content>",
        url: "<redacted-base64>",
      },
      safeText: "contact <masked-email>",
    }),
  );

  assert.equal(
    sanitizeBackendTelemetryValue(JSON.stringify([
      { type: "text", text: "private prompt" },
      { base64Data: "aGVsbG8=", message: "private provider message" },
    ])),
    JSON.stringify([
      { type: "text", text: "<redacted-content>" },
      { base64Data: "<redacted-base64>", message: "<redacted-content>" },
    ]),
  );

  assert.equal(
    sanitizeBackendTelemetryValue("not json {\"prompt\":\"private\"}"),
    "not json {\"prompt\":\"private\"}",
  );
});

test("backend sanitizer masks phone numbers without masking dates and operational IDs", () => {
  const sanitized = sanitizeBackendTelemetryValue(
    "Call +14155552671, 4155552671, or (415) 555-2671 on 2026-05-17 for request 11111111-1111-4111-8111-111111111111.",
  );

  assert.equal(
    sanitized,
    "Call <masked-phone>, <masked-phone>, or <masked-phone> on 2026-05-17 for request 11111111-1111-4111-8111-111111111111.",
  );
});

test("backend sanitizer redacts raw sensitive query strings", () => {
  assert.equal(
    sanitizeBackendTelemetryValue("token=secret&search=private"),
    "<redacted-content>",
  );
  assert.equal(
    sanitizeBackendTelemetryValue("userText=private"),
    "<redacted-content>",
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
