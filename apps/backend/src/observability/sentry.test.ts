import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/aws-serverless";
import {
  addBackendBreadcrumb,
  type ChatWorkerLifecycleDetails,
  captureBackendException,
  captureBackendWarning,
  createBackendObservationScope,
  getBackendSentryConfig,
  initializeBackendSentryWithDeps,
  isBackendSentryInitializedForOpenTelemetry,
  normalizeCaughtError,
  resetBackendSentryForTests,
} from "./sentry";
import { hasReportedBackendException, reportBackendExceptionOrBreadcrumb } from "./reporting";
import { sanitizeBackendTelemetryValue } from "./sanitizer";

type ConsoleMethod = "log" | "warn" | "error";
type MutableSentryModule = typeof Sentry & {
  captureMessage: (
    message: Parameters<typeof Sentry.captureMessage>[0],
    captureContext: Parameters<typeof Sentry.captureMessage>[1],
  ) => ReturnType<typeof Sentry.captureMessage>;
  captureException: (
    exception: Parameters<typeof Sentry.captureException>[0],
  ) => ReturnType<typeof Sentry.captureException>;
  openAIIntegration: typeof Sentry.openAIIntegration;
};

const sentryModule = require("@sentry/aws-serverless") as MutableSentryModule;
type CapturedSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

function requireCapturedSentryInitOptions(
  options: CapturedSentryInitOptions | null,
): CapturedSentryInitOptions {
  if (options === null) {
    throw new Error("Expected backend Sentry init options to be captured.");
  }

  return options;
}

function requireBeforeSend(
  beforeSend: CapturedSentryInitOptions["beforeSend"],
): NonNullable<CapturedSentryInitOptions["beforeSend"]> {
  if (beforeSend === undefined) {
    throw new Error("Expected backend Sentry beforeSend to be configured.");
  }

  return beforeSend;
}

function requireBeforeSendSpan(
  beforeSendSpan: CapturedSentryInitOptions["beforeSendSpan"],
): NonNullable<CapturedSentryInitOptions["beforeSendSpan"]> {
  if (beforeSendSpan === undefined) {
    throw new Error("Expected backend Sentry beforeSendSpan to be configured.");
  }

  return beforeSendSpan;
}

function requireBeforeSendTransaction(
  beforeSendTransaction: CapturedSentryInitOptions["beforeSendTransaction"],
): NonNullable<CapturedSentryInitOptions["beforeSendTransaction"]> {
  if (beforeSendTransaction === undefined) {
    throw new Error("Expected backend Sentry beforeSendTransaction to be configured.");
  }

  return beforeSendTransaction;
}

function requireSynchronousSentryHookResult<Result>(
  result: Result | PromiseLike<Result>,
): Result {
  if (
    typeof result === "object"
    && result !== null
    && "then" in result
    && typeof (result as Readonly<{ then?: unknown }>).then === "function"
  ) {
    throw new Error("Expected backend Sentry hook result to be synchronous in tests.");
  }

  return result as Result;
}

function withCapturedConsole(
  method: ConsoleMethod,
  fn: () => void,
): ReadonlyArray<string> {
  const originalMethod = console[method];
  const messages: Array<string> = [];
  console[method] = (message?: unknown): void => {
    messages.push(typeof message === "string" ? message : String(message));
  };

  try {
    fn();
    return messages;
  } finally {
    console[method] = originalMethod;
  }
}

test("backend Sentry config is disabled outside Lambda without a DSN", () => {
  resetBackendSentryForTests();
  assert.deepEqual(getBackendSentryConfig({}), { enabled: false });
});

test("backend Sentry config requires a DSN in Lambda", () => {
  assert.throws(
    () => getBackendSentryConfig({ AWS_LAMBDA_FUNCTION_NAME: "BackendHandler" }),
    /SENTRY_DSN is required/,
  );
});

test("backend Sentry config validates enabled settings", () => {
  assert.throws(
    () => getBackendSentryConfig({ SENTRY_DSN: "https://example.invalid/1" }),
    /SENTRY_ENVIRONMENT is required/,
  );
  assert.throws(
    () => getBackendSentryConfig({
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "2",
    }),
    /SENTRY_TRACES_SAMPLE_RATE/,
  );

  assert.deepEqual(
    getBackendSentryConfig({
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0.1",
    }),
    {
      enabled: true,
      dsn: "https://example.invalid/1",
      environment: "production",
      release: "abc123",
      tracesSampleRate: 0.1,
    },
  );
});

test("backend Sentry init preserves safe integrations only", () => {
  resetBackendSentryForTests();
  const originalOpenAIIntegration = sentryModule.openAIIntegration;
  let capturedInitOptions: CapturedSentryInitOptions | null = null;
  let capturedOpenAIOptions: Parameters<typeof Sentry.openAIIntegration>[0] | null = null;

  sentryModule.openAIIntegration = (options) => {
    capturedOpenAIOptions = options ?? null;
    return originalOpenAIIntegration(options);
  };

  try {
    initializeBackendSentryWithDeps(
      "backend-api",
      {
        SENTRY_DSN: "https://example.invalid/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "abc123",
        SENTRY_TRACES_SAMPLE_RATE: "0.1",
      },
      {
        init: (options) => {
          capturedInitOptions = options;
        },
      },
    );

    const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
    assert.equal(typeof initOptions.integrations, "function");
    if (typeof initOptions.integrations !== "function") {
      throw new Error("Expected backend Sentry integrations to be configured by factory.");
    }

    const configuredIntegrations = initOptions.integrations([
      Sentry.postgresIntegration(),
      originalOpenAIIntegration(),
      Sentry.httpIntegration(),
      Sentry.nativeNodeFetchIntegration(),
      Sentry.honoIntegration(),
    ]);
    const integrationNames = configuredIntegrations.map((integration: { name: string }) => integration.name);
    assert.deepEqual(integrationNames, ["Http", "NodeFetch", "Hono", "OpenAI"]);
    assert.deepEqual(capturedOpenAIOptions, {
      recordInputs: false,
      recordOutputs: false,
    });
  } finally {
    sentryModule.openAIIntegration = originalOpenAIIntegration;
  }
});

test("backend Sentry init does not register Langfuse span processors on Sentry OpenTelemetry provider", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "chat-live",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0.1",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  assert.equal(initOptions.openTelemetrySpanProcessors, undefined);
  assert.equal(isBackendSentryInitializedForOpenTelemetry(), true);
});

test("backend Sentry OpenTelemetry state is false until enabled init succeeds", () => {
  resetBackendSentryForTests();
  initializeBackendSentryWithDeps(
    "backend-api",
    {},
    {
      init: () => {
        throw new Error("Sentry init should not run when disabled.");
      },
    },
  );
  assert.equal(isBackendSentryInitializedForOpenTelemetry(), false);

  resetBackendSentryForTests();
  assert.throws(
    () => initializeBackendSentryWithDeps(
      "backend-api",
      {
        SENTRY_DSN: "https://example.invalid/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "abc123",
        SENTRY_TRACES_SAMPLE_RATE: "0.1",
      },
      {
        init: () => {
          throw new Error("init failed");
        },
      },
    ),
    /init failed/,
  );
  assert.equal(isBackendSentryInitializedForOpenTelemetry(), false);
});

test("backend Sentry beforeSend drops automatic recaptures of manually captured errors", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "chat-worker",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0.1",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  const beforeSend = requireBeforeSend(initOptions.beforeSend);

  const error = new Error("worker failed");
  withCapturedConsole("error", () => {
    captureBackendException({
      action: "chat_worker_failed",
      error,
      scope: createBackendObservationScope(
        "chat-worker",
        "lambda-request-1",
        null,
        null,
        "user-1",
        "workspace-1",
        null,
        "run-1",
        null,
      ),
      details: {
        lambdaRequestId: "lambda-request-1",
        routeRequestId: null,
        chatRequestId: null,
        runId: "run-1",
        sessionId: null,
        userId: "user-1",
        workspaceId: "workspace-1",
        statusCode: null,
        code: null,
        message: "worker failed",
      },
    });
  });

  const manualEvent: Parameters<NonNullable<CapturedSentryInitOptions["beforeSend"]>>[0] = {
    type: undefined,
    tags: {
      "backend.manual_capture": "true",
    },
  };
  const automaticEvent: Parameters<NonNullable<CapturedSentryInitOptions["beforeSend"]>>[0] = {
    type: undefined,
  };

  assert.notEqual(beforeSend(manualEvent, { originalException: error }), null);
  assert.equal(beforeSend(automaticEvent, { originalException: error }), null);
});

test("backend Sentry beforeSend redacts exception text and request query strings", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "backend-api",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  const beforeSend = requireBeforeSend(initOptions.beforeSend);
  const sanitized = requireSynchronousSentryHookResult(beforeSend({
    type: undefined,
    message: "provider returned private user text user@example.com",
    exception: {
      values: [
        {
          type: "ProviderError",
          value: "provider returned private user text user@example.com",
          stacktrace: {
            frames: [
              {
                context_line: "const prompt = 'private user text';",
                filename: "/var/task/src/chat/runtime.ts",
                function: "runProviderCall",
                lineno: 42,
                colno: 7,
                vars: {
                  prompt: "private user text",
                },
              },
            ],
          },
        },
      ],
    },
    request: {
      query_string: "token=secret&search=private",
    },
    contexts: {
      rawRequest: {
        queryString: "query=private",
        querystring: "userText=private",
      },
    },
  }, {}));

  assert.notEqual(sanitized, null);
  if (sanitized === null) {
    throw new Error("Expected backend Sentry beforeSend to keep the event.");
  }
  assert.equal(sanitized?.message, "<redacted-content>");
  assert.equal(sanitized?.exception?.values?.[0]?.type, "ProviderError");
  assert.equal(sanitized?.exception?.values?.[0]?.value, "<redacted-content>");
  assert.deepEqual(sanitized?.exception?.values?.[0]?.stacktrace?.frames?.[0], {
    context_line: "<redacted-content>",
    filename: "/var/task/src/chat/runtime.ts",
    function: "runProviderCall",
    lineno: 42,
    colno: 7,
    vars: "<redacted-content>",
  });
  assert.equal(sanitized?.request?.query_string, "<redacted-content>");
  assert.equal(sanitized?.contexts?.rawRequest?.queryString, "<redacted-content>");
  assert.equal(sanitized?.contexts?.rawRequest?.querystring, "<redacted-content>");
});

test("backend Sentry beforeSend preserves structural database exception diagnostics", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "backend-api",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  type DatabaseConstraintError = Error & {
    code: string;
    constraint: string;
    table: string;
  };

  const databaseError = new Error(
    "insert or update on table \"workspace_replicas\" violates foreign key constraint \"workspace_replicas_workspace_id_fkey\"",
  ) as DatabaseConstraintError;
  databaseError.name = "DatabaseError";
  databaseError.code = "23503";
  databaseError.constraint = "workspace_replicas_workspace_id_fkey";
  databaseError.table = "workspace_replicas";

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  const beforeSend = requireBeforeSend(initOptions.beforeSend);
  const sanitized = requireSynchronousSentryHookResult(beforeSend({
    type: undefined,
    message: databaseError.message,
    exception: {
      values: [
        {
          type: databaseError.name,
          value: databaseError.message,
          stacktrace: {
            frames: [
              {
                context_line: "await executor.query(sql, [frontText]);",
                vars: {
                  frontText: "private question",
                  backText: "private answer",
                },
              },
            ],
          },
        },
      ],
    },
    request: {
      headers: {
        authorization: "Bearer token-value",
      },
    },
    contexts: {
      backend: {
        prompt: "private prompt",
        sqlState: "23503",
        constraint: "workspace_replicas_workspace_id_fkey",
        table: "workspace_replicas",
      },
      rawRequest: {
        requestBody: {
          frontText: "private question",
          backText: "private answer",
        },
      },
    },
  }, { originalException: databaseError }));

  assert.notEqual(sanitized, null);
  if (sanitized === null) {
    throw new Error("Expected backend Sentry beforeSend to keep the event.");
  }
  assert.match(sanitized.message ?? "", /SQLSTATE 23503/);
  assert.match(sanitized.message ?? "", /workspace_replicas_workspace_id_fkey/);
  assert.match(String(sanitized.exception?.values?.[0]?.value), /SQLSTATE 23503/);
  assert.match(String(sanitized.exception?.values?.[0]?.value), /workspace_replicas_workspace_id_fkey/);
  assert.equal(sanitized.tags?.["db.sql_state"], "23503");
  assert.equal(sanitized.tags?.["db.constraint"], "workspace_replicas_workspace_id_fkey");
  assert.equal(sanitized.tags?.["db.table"], "workspace_replicas");
  assert.deepEqual(sanitized.request, { headers: "<redacted-content>" });
  assert.equal(sanitized.contexts?.backend?.prompt, "<redacted-content>");
  assert.equal(sanitized.contexts?.backend?.sqlState, "23503");
  assert.equal(sanitized.contexts?.backend?.constraint, "workspace_replicas_workspace_id_fkey");
  assert.equal(sanitized.contexts?.backend?.table, "workspace_replicas");
  assert.equal(sanitized.contexts?.rawRequest?.requestBody, "<redacted-content>");
  assert.deepEqual(sanitized.exception?.values?.[0]?.stacktrace?.frames?.[0], {
    context_line: "<redacted-content>",
    vars: "<redacted-content>",
  });
});

test("backend Sentry beforeSend does not preserve content-bearing database exception messages", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "backend-api",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  type DatabaseInputError = Error & {
    code: string;
  };

  const databaseError = new Error("invalid input syntax for type uuid: \"private-user-text\"") as DatabaseInputError;
  databaseError.name = "DatabaseError";
  databaseError.code = "22P02";

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  const beforeSend = requireBeforeSend(initOptions.beforeSend);
  const sanitized = requireSynchronousSentryHookResult(beforeSend({
    type: undefined,
    message: databaseError.message,
    exception: {
      values: [
        {
          type: databaseError.name,
          value: databaseError.message,
          stacktrace: {
            frames: [],
          },
        },
      ],
    },
  }, { originalException: databaseError }));

  assert.notEqual(sanitized, null);
  if (sanitized === null) {
    throw new Error("Expected backend Sentry beforeSend to keep the event.");
  }
  assert.equal(sanitized.message, "DatabaseError: SQLSTATE 22P02");
  assert.equal(sanitized.exception?.values?.[0]?.value, "DatabaseError: SQLSTATE 22P02");
  assert.doesNotMatch(sanitized.message ?? "", /private-user-text/);
  assert.doesNotMatch(String(sanitized.exception?.values?.[0]?.value), /private-user-text/);
});

test("backend Sentry beforeSend preserves typed warning action title only", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "backend-api",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  const beforeSend = requireBeforeSend(initOptions.beforeSend);
  const sanitized = requireSynchronousSentryHookResult(beforeSend({
    type: undefined,
    level: "warning",
    message: "global_snapshot_error",
    tags: {
      "backend.manual_warning_capture": "true",
      "backend.action": "global_snapshot_error",
    },
    contexts: {
      backend: {
        action: "global_snapshot_error",
        message: "Snapshot unavailable for user@example.com",
      },
      rawRequest: {
        queryString: "token=secret&search=private",
      },
    },
    extra: {
      details: {
        message: "S3 object missing for user@example.com",
      },
    },
  }, {}));

  assert.notEqual(sanitized, null);
  if (sanitized === null) {
    throw new Error("Expected backend Sentry beforeSend to keep the event.");
  }
  assert.equal(sanitized.message, "global_snapshot_error");
  assert.equal(sanitized.tags?.["backend.action"], "global_snapshot_error");
  assert.equal(sanitized.contexts?.backend?.message, "<redacted-content>");
  assert.equal(sanitized.contexts?.rawRequest?.queryString, "<redacted-content>");
  assert.deepEqual(sanitized.extra, {
    details: {
      message: "<redacted-content>",
    },
  });
});

test("normalizeCaughtError preserves Error and converts non-Error throws", () => {
  const error = new TypeError("bad input");
  assert.equal(normalizeCaughtError(error), error);

  const normalized = normalizeCaughtError("string failure");
  assert.equal(normalized.name, "NonErrorThrow");
  assert.equal(normalized.message, "string failure");
});

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

test("backend Sentry beforeSendSpan sanitizes span payloads", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "chat-worker",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  const beforeSendSpan = requireBeforeSendSpan(initOptions.beforeSendSpan);
  const beforeSendTransaction = requireBeforeSendTransaction(initOptions.beforeSendTransaction);
  const sanitized = beforeSendSpan({
    data: {
      authorization: "Bearer token-value",
      query: "token=secret&search=private",
      "gen_ai.prompt": "private prompt",
      "gen_ai.completion": "private completion",
      "gen_ai.prompt.0.content": "private prompt part",
      tool_arguments: "{\"frontText\":\"private question\"}",
      "http.request.header.x-user": "private header",
      "http.response.body": "private response body",
      output: "private output",
      hasArguments: true,
      outputLength: 42,
    },
    description: "POST /v1/cards?token=secret&query=private",
    op: "http.client",
    parent_span_id: "2222222222222222",
    span_id: "1111111111111111",
    start_timestamp: 1,
    status: "ok",
    timestamp: 2,
    trace_id: "11111111111111111111111111111111",
  });

  assert.equal(sanitized.description, "POST /v1/cards?<redacted-query>");
  assert.deepEqual(sanitized.data, {
    authorization: "<redacted-secret>",
    query: "<redacted-content>",
    "gen_ai.prompt": "<redacted-content>",
    "gen_ai.completion": "<redacted-content>",
    "gen_ai.prompt.0.content": "<redacted-content>",
    tool_arguments: "<redacted-content>",
    "http.request.header.x-user": "<redacted-content>",
    "http.response.body": "<redacted-content>",
    output: "<redacted-content>",
    hasArguments: true,
    outputLength: 42,
  });

  const sanitizedTransaction = requireSynchronousSentryHookResult(beforeSendTransaction({
    type: "transaction",
    transaction: "GET /v1/cards?token=secret",
    spans: [
      {
        data: {
          input: "private input",
          hasArguments: true,
        },
        description: "GET /v1/cards?token=secret",
        op: "http.server",
        parent_span_id: "1111111111111111",
        span_id: "2222222222222222",
        start_timestamp: 1,
        status: "ok",
        timestamp: 2,
        trace_id: "11111111111111111111111111111111",
      },
    ],
  }, {}));

  assert.notEqual(sanitizedTransaction, null);
  if (sanitizedTransaction === null) {
    throw new Error("Expected backend Sentry beforeSendTransaction to keep the event.");
  }
  assert.equal(sanitizedTransaction.transaction, "GET /v1/cards?<redacted-query>");
  assert.deepEqual(sanitizedTransaction.spans?.[0]?.data, {
    input: "<redacted-content>",
    hasArguments: true,
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

test("backend breadcrumb serialization keeps CloudWatch JSON shape", () => {
  const details: ChatWorkerLifecycleDetails & Readonly<{
    front_text: string;
    nested: Readonly<{
      raw_response_body: string;
      safeCount: number;
    }>;
  }> = {
    lambdaRequestId: "lambda-request-1",
    abortReason: null,
    signalAborted: false,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerErrorStatus: null,
    providerErrorCode: null,
    providerErrorCategory: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    front_text: "private question",
    nested: {
      raw_response_body: "private response",
      safeCount: 2,
    },
  };

  const messages = withCapturedConsole("log", () => {
    addBackendBreadcrumb({
      action: "chat_worker_skip",
      scope: createBackendObservationScope(
        "chat-worker",
        "lambda-request-1",
        null,
        null,
        "user-1",
        "workspace-1",
        "chat-request-1",
        "run-1",
        null,
      ),
      details,
    });
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0] ?? ""), {
    domain: "backend",
    action: "chat_worker_skip",
    service: "chat-worker",
    requestId: "lambda-request-1",
    route: null,
    method: null,
    userId: "user-1",
    workspaceId: "workspace-1",
    chatRequestId: "chat-request-1",
    runId: "run-1",
    sessionId: null,
    lambdaRequestId: "lambda-request-1",
    abortReason: null,
    signalAborted: false,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerErrorStatus: null,
    providerErrorCode: null,
    providerErrorCategory: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    front_text: "<redacted-content>",
    nested: {
      raw_response_body: "<redacted-content>",
      safeCount: 2,
    },
  });
});

test("backend warning and exception serialization include typed details", () => {
  const warningMessages = withCapturedConsole("warn", () => {
    captureBackendWarning({
      action: "global_snapshot_error",
      message: "Snapshot unavailable.",
      scope: createBackendObservationScope(
        "backend-api",
        "request-1",
        "/global/snapshot",
        "GET",
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        statusCode: 503,
        code: "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
        storageErrorMessage: "S3 object missing for user@example.com",
      },
    });
  });

  const error = new Error("invoke failed for user@example.com");
  error.stack = "Error: invoke failed for user@example.com\n    at dispatch (/var/task/src/chat/worker.ts:12:34)";
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "chat_worker_dispatch_failed",
      error,
      scope: createBackendObservationScope(
        "backend-api",
        null,
        null,
        null,
        "user-1",
        "workspace-1",
        null,
        "run-1",
        null,
      ),
      details: {
        message: "invoke failed for user@example.com",
      },
    });
  });

  assert.equal(JSON.parse(warningMessages[0] ?? "").statusCode, 503);
  assert.equal(
    JSON.parse(warningMessages[0] ?? "").storageErrorMessage,
    "S3 object missing for <masked-email>",
  );
  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "chat_worker_dispatch_failed");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "invoke failed for <masked-email>");
  assert.equal(
    exceptionRecord.errorStack,
    "Error: invoke failed for <masked-email>\n    at dispatch (/var/task/src/chat/worker.ts:12:34)",
  );
  assert.equal(exceptionRecord.sourceFile, "/var/task/src/chat/worker.ts");
  assert.equal(exceptionRecord.sourceLine, 12);
  assert.equal(exceptionRecord.sourceColumn, 34);
  assert.equal(exceptionRecord.message, "<redacted-content>");
});

test("backend warnings create Sentry warning issues", () => {
  const originalCaptureMessage = sentryModule.captureMessage;
  let captureMessageCount = 0;
  let capturedMessage: Parameters<typeof Sentry.captureMessage>[0] | null = null;
  sentryModule.captureMessage = (message) => {
    captureMessageCount += 1;
    capturedMessage = message;
    return "event-id";
  };

  try {
    withCapturedConsole("warn", () => {
      captureBackendWarning({
        action: "global_snapshot_error",
        message: "Snapshot unavailable for user@example.com.",
        scope: createBackendObservationScope(
          "backend-api",
          "request-1",
          "/global/snapshot",
          "GET",
          null,
          null,
          null,
          null,
          null,
        ),
        details: {
          statusCode: 503,
          code: "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
          storageErrorMessage: "S3 object missing",
        },
      });
    });

    assert.equal(captureMessageCount, 1);
    assert.equal(capturedMessage, "global_snapshot_error");
  } finally {
    sentryModule.captureMessage = originalCaptureMessage;
  }
});

test("backend reporting does not recapture already captured exceptions", () => {
  const originalCaptureException = sentryModule.captureException;
  let captureExceptionCount = 0;
  sentryModule.captureException = () => {
    captureExceptionCount += 1;
    return "event-id";
  };

  try {
    const error = new Error("dispatch failed");
    const scope = createBackendObservationScope(
      "backend-api",
      "request-1",
      "/chat/worker",
      "POST",
      "user-1",
      "workspace-1",
      null,
      "run-1",
      null,
    );
    const event = {
      action: "workspace_create_error",
      error,
      scope,
      details: {
        statusCode: 500,
        code: "WORKSPACE_CREATE_FAILED",
        message: "dispatch failed",
        validationIssues: [],
      },
    } as const;

    withCapturedConsole("error", () => {
      captureBackendException(event);
    });
    const breadcrumbMessages = withCapturedConsole("log", () => {
      reportBackendExceptionOrBreadcrumb(
        error,
        event,
        {
          action: "workspace_create_error",
          scope,
          details: {
            statusCode: 500,
            code: "WORKSPACE_CREATE_FAILED",
            message: "dispatch failed",
            validationIssues: [],
          },
        },
      );
    });

    assert.equal(captureExceptionCount, 1);
    assert.equal(JSON.parse(breadcrumbMessages[0] ?? "").action, "workspace_create_error");
  } finally {
    sentryModule.captureException = originalCaptureException;
  }
});

test("backend reporting recognizes repeated normalized non-Error throws", () => {
  const originalCaptureException = sentryModule.captureException;
  let captureExceptionCount = 0;
  sentryModule.captureException = () => {
    captureExceptionCount += 1;
    return "event-id";
  };

  try {
    const thrownError = "non-error route failure";
    const scope = createBackendObservationScope(
      "backend-api",
      "request-2",
      "/sync/push",
      "POST",
      "user-2",
      "workspace-2",
      null,
      null,
      null,
    );
    const routeEvent = {
      action: "workspace_create_error",
      error: normalizeCaughtError(thrownError),
      scope,
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: thrownError,
        validationIssues: [],
      },
    } as const;
    const appEvent = {
      action: "request_failed",
      error: normalizeCaughtError(thrownError),
      scope,
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: thrownError,
        validationIssues: [],
      },
    } as const;

    withCapturedConsole("error", () => {
      reportBackendExceptionOrBreadcrumb(
        thrownError,
        routeEvent,
        {
          action: "workspace_create_error",
          scope,
          details: {
            statusCode: 500,
            code: "INTERNAL_ERROR",
            message: thrownError,
            validationIssues: [],
          },
        },
      );
    });
    const appDetectedPreviousReport = hasReportedBackendException(appEvent.error);
    if (appDetectedPreviousReport === false) {
      withCapturedConsole("error", () => {
        captureBackendException(appEvent);
      });
    }

    assert.equal(appDetectedPreviousReport, true);
    assert.equal(captureExceptionCount, 1);
  } finally {
    sentryModule.captureException = originalCaptureException;
  }
});

test("backend runtime exception serialization includes chat worker failure context", () => {
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "chat_worker_failed",
      error: new Error("worker failed"),
      scope: createBackendObservationScope(
        "chat-worker",
        "lambda-request-1",
        null,
        null,
        "user-1",
        "workspace-1",
        "chat-request-1",
        "run-1",
        "session-1",
      ),
      details: {
        lambdaRequestId: "lambda-request-1",
        routeRequestId: "route-request-1",
        chatRequestId: "chat-request-1",
        runId: "run-1",
        sessionId: "session-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        statusCode: null,
        code: null,
        message: "worker failed",
      },
    });
  });

  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "chat_worker_failed");
  assert.equal(exceptionRecord.service, "chat-worker");
  assert.equal(exceptionRecord.requestId, "lambda-request-1");
  assert.equal(exceptionRecord.lambdaRequestId, "lambda-request-1");
  assert.equal(exceptionRecord.routeRequestId, "route-request-1");
  assert.equal(exceptionRecord.chatRequestId, "chat-request-1");
  assert.equal(exceptionRecord.userId, "user-1");
  assert.equal(exceptionRecord.workspaceId, "workspace-1");
  assert.equal(exceptionRecord.runId, "run-1");
  assert.equal(exceptionRecord.sessionId, "session-1");
  assert.equal(exceptionRecord.statusCode, null);
  assert.equal(exceptionRecord.code, null);
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "worker failed");
  assert.equal("error" in exceptionRecord, false);
});

test("backend runtime exception serialization includes global metrics failure context", () => {
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "global_metrics_snapshot_failed",
      error: new Error("snapshot failed"),
      scope: createBackendObservationScope(
        "global-metrics-snapshot",
        "lambda-request-2",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        bucketName: "metrics-bucket",
        objectKey: "v1/global-snapshot.json",
        message: "snapshot failed",
      },
    });
  });

  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "global_metrics_snapshot_failed");
  assert.equal(exceptionRecord.service, "global-metrics-snapshot");
  assert.equal(exceptionRecord.requestId, "lambda-request-2");
  assert.equal(exceptionRecord.bucketName, "metrics-bucket");
  assert.equal(exceptionRecord.objectKey, "v1/global-snapshot.json");
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "snapshot failed");
  assert.equal("error" in exceptionRecord, false);
});

test("backend runtime exception serialization includes migration failure context", () => {
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "migration_failed",
      error: new Error("migration failed"),
      scope: createBackendObservationScope(
        "migration",
        "lambda-request-3",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        migrationSurface: "lambda",
        operation: "run_migrations",
        message: "migration failed",
      },
    });
  });

  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "migration_failed");
  assert.equal(exceptionRecord.service, "migration");
  assert.equal(exceptionRecord.requestId, "lambda-request-3");
  assert.equal(exceptionRecord.migrationSurface, "lambda");
  assert.equal(exceptionRecord.operation, "run_migrations");
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "migration failed");
  assert.equal("error" in exceptionRecord, false);
});
