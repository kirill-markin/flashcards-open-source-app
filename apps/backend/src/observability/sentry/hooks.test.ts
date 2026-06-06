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
      url: "https://api.example.invalid/v1/cards?token=secret#debug",
    },
    contexts: {
      backend: {
        adminEmail: "local-admin@localhost",
        userEmail: "user@example.com",
        safeText:
          "contact user@example.com with key sk-proj-123456789012345678901234 and jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        serializedPayload: JSON.stringify({
          authorization: "Bearer token-value",
          query: "token=secret&search=private",
          email: "payload@example.com",
          safeText: "contact payload@example.com",
          nested: {
            hasToken: true,
            tokenCount: 7,
            sessionToken: "session-token-value",
          },
        }),
      },
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
  assert.equal(sanitized?.request?.url, "https://api.example.invalid/v1/cards");
  assert.equal(sanitized?.contexts?.backend?.adminEmail, "<redacted-content>");
  assert.equal(sanitized?.contexts?.backend?.userEmail, "<redacted-content>");
  assert.equal(
    sanitized?.contexts?.backend?.safeText,
    "contact <masked-email> with key <masked-api-key> and jwt <masked-jwt>",
  );
  const serializedPayload = sanitized?.contexts?.backend?.serializedPayload;
  assert.equal(typeof serializedPayload, "string");
  if (typeof serializedPayload !== "string") {
    throw new Error("Expected serialized Sentry payload to remain a string.");
  }
  assert.deepEqual(JSON.parse(serializedPayload), {
    authorization: "<redacted-secret>",
    query: "<redacted-content>",
    email: "<redacted-content>",
    safeText: "contact <masked-email>",
    nested: {
      hasToken: true,
      tokenCount: 7,
      sessionToken: "<redacted-secret>",
    },
  });
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
  assert.deepEqual(sanitized.request, { headers: { authorization: "<redacted-secret>" } });
  assert.equal(sanitized.contexts?.backend?.prompt, "private prompt");
  assert.equal(sanitized.contexts?.backend?.sqlState, "23503");
  assert.equal(sanitized.contexts?.backend?.constraint, "workspace_replicas_workspace_id_fkey");
  assert.equal(sanitized.contexts?.backend?.table, "workspace_replicas");
  assert.deepEqual(sanitized.contexts?.rawRequest?.requestBody, {
    frontText: "private question",
    backText: "private answer",
  });
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

test("backend Sentry scope preserves raw backend identifiers before capture", () => {
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
  assert.equal(capturedUnsafeScope.tags.get("workspaceId"), "workspace-1");
  assert.equal(capturedUnsafeScope.tags.get("runId"), "run-1");
  assert.equal(capturedUnsafeScope.tags.get("sessionId"), "session-1");
  assert.equal(capturedUnsafeScope.tags.get("userId"), "user-1");
  assert.equal(capturedUnsafeScope.tags.get("workspaceIdHash"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("runIdHash"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("sessionIdHash"), undefined);
  assert.equal(capturedUnsafeScope.tags.get("userIdHash"), undefined);
  assert.deepEqual(capturedUnsafeScope.users, [
    { id: "user-1" },
  ]);

  const unsafeBackendContext = requireRecord(capturedUnsafeScope.contexts.get("backend"));
  assert.equal(unsafeBackendContext.requestId, backendRequestId);
  assert.equal(unsafeBackendContext.requestIdHash, undefined);
  assert.equal(unsafeBackendContext.route, "/v1/chat/live");
  assert.equal(unsafeBackendContext.method, "GET");
  assert.equal(unsafeBackendContext.chatRequestId, safeChatRequestId);
  assert.equal(unsafeBackendContext.userId, "user-1");
  assert.equal(unsafeBackendContext.workspaceId, "workspace-1");
  assert.equal(unsafeBackendContext.runId, "run-1");
  assert.equal(unsafeBackendContext.sessionId, "session-1");

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
  assert.match(serializedUnsafeScope, /workspace-1/);
  assert.match(serializedUnsafeScope, /user-1/);
  assert.match(serializedUnsafeScope, /run-1/);
  assert.match(serializedUnsafeScope, /session-1/);
  assert.doesNotMatch(serializedUnsafeScope, /userIdHash|workspaceIdHash|runIdHash|sessionIdHash/);
});

test("backend Sentry beforeSend preserves raw backend and entity identifiers", () => {
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
        targetUserId: "user-3",
        targetSubjectUserId: "user-2",
        affectedUserIds: ["user-4", "user-5"],
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
  assert.equal(sanitized.tags?.clientRequestId, legacyClientRequestId);
  assert.equal(sanitized.tags?.userId, "user-1");
  assert.equal(sanitized.tags?.workspaceId, "workspace-1");
  assert.equal(sanitized.tags?.runId, "run-1");
  assert.equal(sanitized.tags?.sessionId, "session-1");
  assert.equal(sanitized.tags?.requestIdHash, undefined);
  assert.equal(sanitized.tags?.clientRequestIdHash, undefined);
  assert.equal(sanitized.tags?.userIdHash, undefined);
  assert.equal(sanitized.tags?.workspaceIdHash, undefined);
  assert.equal(sanitized.tags?.runIdHash, undefined);
  assert.equal(sanitized.tags?.sessionIdHash, undefined);

  assert.deepEqual(sanitized.contexts?.backend, {
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
  });
  assert.equal(sanitized.contexts?.details?.requestId, backendRequestId);
  assert.equal(sanitized.contexts?.details?.requestIdHash, undefined);
  assert.equal(sanitized.contexts?.details?.clientRequestId, legacyClientRequestId);
  assert.equal(sanitized.contexts?.details?.clientRequestIdHash, undefined);
  assert.equal(sanitized.contexts?.details?.chatRequestId, legacyChatRequestId);
  assert.equal(sanitized.contexts?.details?.chatRequestIdHash, undefined);
  assert.equal(sanitized.contexts?.details?.selectedWorkspaceId, "workspace-2");
  assert.equal(sanitized.contexts?.details?.selectedWorkspaceIdHash, undefined);
  assert.equal(sanitized.contexts?.details?.hasWorkspaceId, true);
  assert.equal(sanitized.contexts?.details?.selectedWorkspaceIdBeforeDelete, "workspace-3");
  assert.equal(sanitized.contexts?.details?.selectedWorkspaceIdBeforeDeleteHash, undefined);
  assert.equal(sanitized.contexts?.details?.targetUserId, "user-3");
  assert.equal(sanitized.contexts?.details?.targetUserIdHash, undefined);
  assert.equal(sanitized.contexts?.details?.targetSubjectUserId, "user-2");
  assert.equal(sanitized.contexts?.details?.targetSubjectUserIdHash, undefined);
  assert.deepEqual(sanitized.contexts?.details?.affectedUserIds, ["user-4", "user-5"]);
  assert.equal(sanitized.contexts?.details?.affectedUserIdsHash, undefined);
  assert.equal(sanitized.contexts?.details?.cardId, "card-1");
  assert.equal(sanitized.contexts?.details?.cardIdHash, undefined);

  const breadcrumbData = sanitized.breadcrumbs?.[0]?.data;
  assert.equal(breadcrumbData?.scope?.requestId, backendRequestId);
  assert.equal(breadcrumbData?.scope?.requestIdHash, undefined);
  assert.equal(breadcrumbData?.scope?.workspaceId, "workspace-1");
  assert.equal(breadcrumbData?.scope?.workspaceIdHash, undefined);
  assert.equal(breadcrumbData?.details?.clientRequestId, legacyClientRequestId);
  assert.equal(breadcrumbData?.details?.clientRequestIdHash, undefined);
  assert.equal(breadcrumbData?.details?.sourceGuestWorkspaceId, "workspace-2");
  assert.equal(breadcrumbData?.details?.sourceGuestWorkspaceIdHash, undefined);
  assert.equal(breadcrumbData?.details?.reviewEventId, "review-event-1");
  assert.equal(breadcrumbData?.details?.reviewEventIdHash, undefined);

  const serializedPayload = JSON.stringify(sanitized);
  assert.match(serializedPayload, /legacy-client-request/);
  assert.match(serializedPayload, /legacy-chat-request/);
  assert.match(serializedPayload, /workspace-1/);
  assert.match(serializedPayload, /workspace-2/);
  assert.match(serializedPayload, /workspace-3/);
  assert.match(serializedPayload, /user-1/);
  assert.match(serializedPayload, /user-2/);
  assert.match(serializedPayload, /user-3/);
  assert.match(serializedPayload, /user-4/);
  assert.match(serializedPayload, /user-5/);
  assert.match(serializedPayload, /run-1/);
  assert.match(serializedPayload, /session-1/);
  assert.match(serializedPayload, /card-1/);
  assert.match(serializedPayload, /review-event-1/);
  assert.doesNotMatch(
    serializedPayload,
    /clientRequestIdHash|userIdHash|workspaceIdHash|runIdHash|sessionIdHash|targetUserIdHash|targetSubjectUserIdHash|affectedUserIdsHash|cardIdHash|reviewEventIdHash/,
  );
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
      hasToken: true,
      input_tokens: 11,
      outputTokens: 12,
      outputLength: 42,
      sessionToken: "session-token-value",
      tokenCount: 7,
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

  assert.equal(sanitized.description, "POST /v1/cards");
  assert.deepEqual(sanitized.data, {
    authorization: "<redacted-secret>",
    query: "<redacted-content>",
    "gen_ai.prompt": "private prompt",
    "gen_ai.completion": "private completion",
    "gen_ai.prompt.0.content": "private prompt part",
    tool_arguments: "{\"frontText\":\"private question\"}",
    "http.request.header.x-user": "private header",
    "http.response.body": "private response body",
    output: "private output",
    hasArguments: true,
    hasToken: true,
    input_tokens: 11,
    outputTokens: 12,
    outputLength: 42,
    sessionToken: "<redacted-secret>",
    tokenCount: 7,
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
  assert.equal(sanitizedTransaction.transaction, "GET /v1/cards");
  assert.deepEqual(sanitizedTransaction.spans?.[0]?.data, {
    input: "private input",
    hasArguments: true,
  });
});
