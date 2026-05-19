import assert from "node:assert/strict";
import test from "node:test";
import { captureBackendException } from "./capture";
import {
  initializeBackendSentryWithDeps,
  resetBackendSentryForTests,
} from "./config";
import {
  createBackendObservationScope,
  setSentryScope,
} from "./scope";
import {
  type CapturedSentryInitOptions,
  requireBeforeSend,
  requireBeforeSendSpan,
  requireBeforeSendTransaction,
  requireCapturedSentryInitOptions,
  requireSynchronousSentryHookResult,
  withCapturedConsole,
} from "./testHelpers";

type CapturedScope = Readonly<{
  scope: Parameters<typeof setSentryScope>[0];
  tags: Map<string, string>;
  users: Array<Parameters<Parameters<typeof setSentryScope>[0]["setUser"]>[0]>;
  contexts: Map<string, Parameters<Parameters<typeof setSentryScope>[0]["setContext"]>[1]>;
}>;

function createCapturedScope(): CapturedScope {
  type Scope = Parameters<typeof setSentryScope>[0];
  type ScopeUser = Parameters<Scope["setUser"]>[0];
  type ScopeContext = Parameters<Scope["setContext"]>[1];

  const tags: Map<string, string> = new Map();
  const users: Array<ScopeUser> = [];
  const contexts: Map<string, ScopeContext> = new Map();
  let scope: Scope;
  scope = {
    setTag: (key: string, value: string): Scope => {
      tags.set(key, value);
      return scope;
    },
    setUser: (user: ScopeUser): Scope => {
      users.push(user);
      return scope;
    },
    setContext: (name: string, context: ScopeContext): Scope => {
      contexts.set(name, context);
      return scope;
    },
  } as unknown as Scope;

  return {
    scope,
    tags,
    users,
    contexts,
  };
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected value to be a record.");
  }

  return value as Readonly<Record<string, unknown>>;
}

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

test("backend Sentry scope preserves backend request id tags before capture", () => {
  const safeRequestId = "11111111-2222-4333-8444-555555555555";
  const safeChatRequestId = "22222222-3333-4444-8555-666666666666";
  const backendRequestId = "api-gateway-request-1";
  const capturedUnsafeScope = createCapturedScope();

  setSentryScope(
    capturedUnsafeScope.scope,
    createBackendObservationScope(
      "chat-live",
      backendRequestId,
      "/v1/chat/live",
      "GET",
      "user-1",
      "workspace-1",
      safeChatRequestId,
      "run-1",
      "session-1",
    ),
  );

  assert.equal(capturedUnsafeScope.tags.get("backend.service"), "chat-live");
  assert.equal(capturedUnsafeScope.tags.get("route"), "/v1/chat/live");
  assert.equal(capturedUnsafeScope.tags.get("method"), "GET");
  assert.equal(capturedUnsafeScope.tags.get("requestId"), backendRequestId);
  assert.equal(capturedUnsafeScope.tags.get("requestIdHash"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("chatRequestId"), safeChatRequestId);
  assert.equal(capturedUnsafeScope.tags.get("workspaceId"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("runId"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("sessionId"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("userId"), undefined);
  assert.match(String(capturedUnsafeScope.tags.get("workspaceIdHash")), /^[a-f0-9]{64}$/);
  assert.match(String(capturedUnsafeScope.tags.get("runIdHash")), /^[a-f0-9]{64}$/);
  assert.match(String(capturedUnsafeScope.tags.get("sessionIdHash")), /^[a-f0-9]{64}$/);
  assert.match(String(capturedUnsafeScope.tags.get("userIdHash")), /^[a-f0-9]{64}$/);
  assert.deepEqual(capturedUnsafeScope.users, [
    { id: capturedUnsafeScope.tags.get("userIdHash") },
  ]);

  const unsafeBackendContext = requireRecord(capturedUnsafeScope.contexts.get("backend"));
  assert.equal(unsafeBackendContext.requestId, backendRequestId);
  assert.equal(unsafeBackendContext.requestIdHash, undefined);
  assert.equal(unsafeBackendContext.route, "/v1/chat/live");
  assert.equal(unsafeBackendContext.method, "GET");
  assert.equal(unsafeBackendContext.chatRequestId, safeChatRequestId);

  const capturedSafeScope = createCapturedScope();
  setSentryScope(
    capturedSafeScope.scope,
    createBackendObservationScope(
      "backend-api",
      safeRequestId,
      "/v1/cards",
      "POST",
      null,
      null,
      null,
      null,
      null,
    ),
  );

  assert.equal(capturedSafeScope.tags.get("requestId"), safeRequestId);
  assert.equal(capturedSafeScope.tags.get("requestIdHash"), undefined);

  const serializedUnsafeScope = JSON.stringify({
    tags: Object.fromEntries(capturedUnsafeScope.tags),
    users: capturedUnsafeScope.users,
    contexts: Object.fromEntries(capturedUnsafeScope.contexts),
  });
  assert.match(serializedUnsafeScope, /api-gateway-request-1/);
  assert.doesNotMatch(serializedUnsafeScope, /workspace-1|user-1|run-1|session-1/);
});

test("backend Sentry beforeSend preserves backend request ids and hashes client/entity identifiers", () => {
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
  const beforeSend = requireBeforeSend(initOptions.beforeSend);
  const safeChatRequestId = "11111111-2222-4333-8444-555555555555";
  const backendRequestId = "lambda-request-1";
  const legacyClientRequestId = "legacy-client-request";
  const legacyChatRequestId = "legacy-chat-request";
  const sanitized = requireSynchronousSentryHookResult(beforeSend({
    type: undefined,
    tags: {
      requestId: backendRequestId,
      lambdaRequestId: "lambda-correlation-1",
      routeRequestId: "route-correlation-1",
      backendRequestId: "backend-correlation-1",
      providerRequestId: "provider-correlation-1",
      upstreamRequestId: "upstream-correlation-1",
      chatRequestId: safeChatRequestId,
      clientRequestId: legacyClientRequestId,
      userId: "user-1",
      workspaceId: "workspace-1",
      runId: "run-1",
      sessionId: "session-1",
    },
    contexts: {
      backend: {
        requestId: backendRequestId,
        lambdaRequestId: "lambda-correlation-1",
        routeRequestId: "route-correlation-1",
        backendRequestId: "backend-correlation-1",
        providerRequestId: "provider-correlation-1",
        upstreamRequestId: "upstream-correlation-1",
        chatRequestId: safeChatRequestId,
        clientRequestId: legacyClientRequestId,
        userId: "user-1",
        workspaceId: "workspace-1",
        runId: "run-1",
        sessionId: "session-1",
      },
      details: {
        hasWorkspaceId: true,
        requestId: backendRequestId,
        chatRequestId: legacyChatRequestId,
        clientRequestId: legacyClientRequestId,
        selectedWorkspaceId: "workspace-2",
        selectedWorkspaceIdBeforeDelete: "workspace-3",
        targetSubjectUserId: "user-2",
        cardId: "card-1",
      },
    },
    breadcrumbs: [
      {
        timestamp: 1,
        category: "backend",
        data: {
          scope: {
            requestId: backendRequestId,
            workspaceId: "workspace-1",
          },
          details: {
            clientRequestId: legacyClientRequestId,
            sourceGuestWorkspaceId: "workspace-2",
            reviewEventId: "review-event-1",
          },
        },
      },
    ],
  }, {}));

  assert.notEqual(sanitized, null);
  if (sanitized === null) {
    throw new Error("Expected backend Sentry beforeSend to keep the event.");
  }

  assert.equal(sanitized.tags?.requestId, backendRequestId);
  assert.equal(sanitized.tags?.lambdaRequestId, "lambda-correlation-1");
  assert.equal(sanitized.tags?.routeRequestId, "route-correlation-1");
  assert.equal(sanitized.tags?.backendRequestId, "backend-correlation-1");
  assert.equal(sanitized.tags?.providerRequestId, "provider-correlation-1");
  assert.equal(sanitized.tags?.upstreamRequestId, "upstream-correlation-1");
  assert.equal(sanitized.tags?.chatRequestId, safeChatRequestId);
  assert.equal(sanitized.tags?.clientRequestId, undefined);
  assert.equal(sanitized.tags?.userId, undefined);
  assert.equal(sanitized.tags?.workspaceId, undefined);
  assert.equal(sanitized.tags?.runId, undefined);
  assert.equal(sanitized.tags?.sessionId, undefined);
  assert.equal(sanitized.tags?.requestIdHash, undefined);
  assert.match(String(sanitized.tags?.clientRequestIdHash), /^[a-f0-9]{64}$/);
  assert.match(String(sanitized.tags?.userIdHash), /^[a-f0-9]{64}$/);
  assert.match(String(sanitized.tags?.workspaceIdHash), /^[a-f0-9]{64}$/);
  assert.match(String(sanitized.tags?.runIdHash), /^[a-f0-9]{64}$/);
  assert.match(String(sanitized.tags?.sessionIdHash), /^[a-f0-9]{64}$/);

  assert.deepEqual(sanitized.contexts?.backend, {
    requestId: backendRequestId,
    lambdaRequestId: "lambda-correlation-1",
    routeRequestId: "route-correlation-1",
    backendRequestId: "backend-correlation-1",
    providerRequestId: "provider-correlation-1",
    upstreamRequestId: "upstream-correlation-1",
    chatRequestId: safeChatRequestId,
    clientRequestIdHash: sanitized.tags?.clientRequestIdHash,
    userIdHash: sanitized.tags?.userIdHash,
    workspaceIdHash: sanitized.tags?.workspaceIdHash,
    runIdHash: sanitized.tags?.runIdHash,
    sessionIdHash: sanitized.tags?.sessionIdHash,
  });
  assert.equal(sanitized.contexts?.details?.requestId, backendRequestId);
  assert.equal(sanitized.contexts?.details?.requestIdHash, undefined);
  assert.equal(sanitized.contexts?.details?.clientRequestId, undefined);
  assert.match(String(sanitized.contexts?.details?.clientRequestIdHash), /^[a-f0-9]{64}$/);
  assert.equal(sanitized.contexts?.details?.chatRequestId, undefined);
  assert.match(String(sanitized.contexts?.details?.chatRequestIdHash), /^[a-f0-9]{64}$/);
  assert.equal(sanitized.contexts?.details?.selectedWorkspaceId, undefined);
  assert.match(String(sanitized.contexts?.details?.selectedWorkspaceIdHash), /^[a-f0-9]{64}$/);
  assert.equal(sanitized.contexts?.details?.hasWorkspaceId, true);
  assert.equal(sanitized.contexts?.details?.selectedWorkspaceIdBeforeDelete, undefined);
  assert.match(String(sanitized.contexts?.details?.selectedWorkspaceIdBeforeDeleteHash), /^[a-f0-9]{64}$/);
  assert.equal(sanitized.contexts?.details?.targetSubjectUserId, undefined);
  assert.match(String(sanitized.contexts?.details?.targetSubjectUserIdHash), /^[a-f0-9]{64}$/);
  assert.equal(sanitized.contexts?.details?.cardId, undefined);
  assert.match(String(sanitized.contexts?.details?.cardIdHash), /^[a-f0-9]{64}$/);

  const breadcrumbData = sanitized.breadcrumbs?.[0]?.data;
  assert.equal(breadcrumbData?.scope?.requestId, backendRequestId);
  assert.equal(breadcrumbData?.scope?.requestIdHash, undefined);
  assert.equal(breadcrumbData?.scope?.workspaceId, undefined);
  assert.match(String(breadcrumbData?.scope?.workspaceIdHash), /^[a-f0-9]{64}$/);
  assert.equal(breadcrumbData?.details?.clientRequestId, undefined);
  assert.match(String(breadcrumbData?.details?.clientRequestIdHash), /^[a-f0-9]{64}$/);
  assert.equal(breadcrumbData?.details?.sourceGuestWorkspaceId, undefined);
  assert.match(String(breadcrumbData?.details?.sourceGuestWorkspaceIdHash), /^[a-f0-9]{64}$/);
  assert.equal(breadcrumbData?.details?.reviewEventId, undefined);
  assert.match(String(breadcrumbData?.details?.reviewEventIdHash), /^[a-f0-9]{64}$/);

  const serializedPayload = JSON.stringify(sanitized);
  assert.doesNotMatch(serializedPayload, /legacy-client-request|legacy-chat-request|workspace-1|workspace-2|workspace-3|user-1|user-2|run-1|session-1|card-1|review-event-1/);
  assert.match(serializedPayload, /lambda-request-1/);
  assert.match(serializedPayload, /lambda-correlation-1/);
  assert.match(serializedPayload, /route-correlation-1/);
  assert.match(serializedPayload, /backend-correlation-1/);
  assert.match(serializedPayload, /provider-correlation-1/);
  assert.match(serializedPayload, /upstream-correlation-1/);
  assert.match(serializedPayload, /11111111-2222-4333-8444-555555555555/);
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
