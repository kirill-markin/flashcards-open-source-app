import assert from "node:assert/strict";
import test from "node:test";
import { captureBackendException } from "./sentryCapture";
import {
  initializeBackendSentryWithDeps,
  resetBackendSentryForTests,
} from "./sentryConfig";
import { createBackendObservationScope } from "./sentryScope";
import {
  type CapturedSentryInitOptions,
  requireBeforeSend,
  requireBeforeSendSpan,
  requireBeforeSendTransaction,
  requireCapturedSentryInitOptions,
  requireSynchronousSentryHookResult,
  withCapturedConsole,
} from "./sentryTestHelpers";

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
