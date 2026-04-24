import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "../../errors";
import { createChatRoutes } from "../../routes/chat";
import { buildInitialChatComposerSuggestions } from "../composerSuggestions";
import { createChatSessionRequestedSessionIdConflictError } from "../errors";
import type { ChatSessionSnapshot } from "../store";
import { ChatSessionConflictError } from "../store";
import type { RecoveredPaginatedSession } from "../runs";
import type { RequestContext } from "../../server/requestContext";

const SESSION_ONE = "11111111-1111-4111-8111-111111111111";
const SESSION_TWO = "22222222-2222-4222-8222-222222222222";
const EXPLICIT_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const LEGACY_WORKSPACE_ID = "workspace-legacy";

function createRequestContext(): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "user-1",
    selectedWorkspaceId: "workspace-1",
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-03-30T00:00:00.000Z",
    transport: "bearer",
    connectionId: null,
  };
}

function createRequestContextWithSelectedWorkspace(selectedWorkspaceId: string | null): RequestContext {
  return {
    ...createRequestContext(),
    selectedWorkspaceId,
  };
}

function createSnapshot(messages: ChatSessionSnapshot["messages"]): ChatSessionSnapshot {
  return {
    sessionId: SESSION_ONE,
    runState: "idle",
    activeRunId: null,
    updatedAt: 1,
    activeRunHeartbeatAt: null,
    composerSuggestions: [],
    mainContentInvalidationVersion: 0,
    messages,
  };
}

function createRunningSnapshot(messages: ChatSessionSnapshot["messages"]): ChatSessionSnapshot {
  return {
    sessionId: SESSION_ONE,
    runState: "running",
    activeRunId: "run-1",
    updatedAt: 1,
    activeRunHeartbeatAt: 1,
    composerSuggestions: [],
    mainContentInvalidationVersion: 0,
    messages,
  };
}

function createExpectedChatConfig(): Record<string, unknown> {
  return {
    provider: {
      id: "openai",
      label: "OpenAI",
    },
    model: {
      id: "gpt-5.4",
      label: "GPT-5.4",
      badgeLabel: "GPT-5.4 · Medium",
    },
    reasoning: {
      effort: "medium",
      label: "Medium",
    },
    features: {
      modelPickerEnabled: false,
      dictationEnabled: true,
      attachmentsEnabled: true,
    },
    liveUrl: null,
  };
}

function toHttpErrorLike(error: unknown): { statusCode: number; message: string; code: string | null } | null {
  if (error instanceof HttpError) {
    return error;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const message = "message" in error ? error.message : undefined;
  const code = "code" in error ? error.code : undefined;
  if (typeof statusCode !== "number" || typeof message !== "string" || (typeof code !== "string" && code !== null)) {
    return null;
  }

  return { statusCode, message, code };
}

test("POST /chat/new returns the current session when history is empty", async () => {
  let rolloverCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => SESSION_ONE,
    getRecoveredChatSessionSnapshotFn: async () => ({
      ...createSnapshot([]),
      composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    }),
    rolloverToFreshChatSessionFn: async () => {
      rolloverCallCount += 1;
      return SESSION_TWO;
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(rolloverCallCount, 0);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: SESSION_ONE,
    composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new localizes initial suggestions from uiLocale", async () => {
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => SESSION_ONE,
    getRecoveredChatSessionSnapshotFn: async () => ({
      ...createSnapshot([]),
      composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    }),
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      uiLocale: "es_MX",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: SESSION_ONE,
    composerSuggestions: buildInitialChatComposerSuggestions("es-MX"),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new rejects an invalid uiLocale", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      uiLocale: "bad locale!!!",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "uiLocale is invalid",
    requestId: null,
    code: null,
  });
});

test("POST /chat/new returns the existing explicit session unchanged when history is not empty", async () => {
  const requestedSessionIds: Array<string | undefined> = [];
  let rolloverCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => SESSION_ONE,
    getRecoveredChatSessionSnapshotFn: async (
      _userId: string,
      _workspaceId: string,
      sessionId?: string,
    ) => {
      requestedSessionIds.push(sessionId);
      return {
        ...createSnapshot([
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
            timestamp: 1,
            isError: false,
            isStopped: false,
            cursor: "1",
            itemId: null,
          },
        ]),
        composerSuggestions: buildInitialChatComposerSuggestions(undefined),
      };
    },
    rolloverToFreshChatSessionFn: async () => {
      rolloverCallCount += 1;
      return SESSION_TWO;
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedSessionIds, [SESSION_ONE]);
  assert.equal(rolloverCallCount, 0);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: SESSION_ONE,
    composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new returns the existing explicit session unchanged when run state is active", async () => {
  let rolloverCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => SESSION_ONE,
    getRecoveredChatSessionSnapshotFn: async (
      _userId: string,
      _workspaceId: string,
      sessionId?: string,
    ) => {
      return {
        ...createRunningSnapshot([]),
        composerSuggestions: buildInitialChatComposerSuggestions(undefined),
      };
    },
    rolloverToFreshChatSessionFn: async () => {
      rolloverCallCount += 1;
      return SESSION_TWO;
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(rolloverCallCount, 0);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: SESSION_ONE,
    composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new creates the exact explicit session when it does not exist yet", async () => {
  const requestedSessionIds: Array<string | undefined> = [];
  const createdSessionIds: string[] = [];
  const createdUiLocales: Array<string | null> = [];
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => null,
    createFreshChatSessionFn: async (_userId, _workspaceId, requestedSessionId, uiLocale) => {
      assert.equal(requestedSessionId, SESSION_TWO);
      createdSessionIds.push(requestedSessionId ?? "");
      createdUiLocales.push(uiLocale);
      return requestedSessionId ?? SESSION_TWO;
    },
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => {
      requestedSessionIds.push(sessionId);
      return {
        ...createSnapshot([]),
        sessionId: sessionId ?? SESSION_ONE,
        composerSuggestions: buildInitialChatComposerSuggestions(undefined),
      };
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_TWO,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(createdSessionIds, [SESSION_TWO]);
  assert.deepEqual(createdUiLocales, [null]);
  assert.deepEqual(requestedSessionIds, [SESSION_TWO]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: SESSION_TWO,
    composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new persists localized initial suggestions for a created explicit session", async () => {
  let persistedUiLocale: string | null = null;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => null,
    createFreshChatSessionFn: async (_userId, _workspaceId, requestedSessionId, uiLocale) => {
      assert.equal(requestedSessionId, SESSION_TWO);
      persistedUiLocale = uiLocale;
      return requestedSessionId ?? SESSION_TWO;
    },
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => ({
      ...createSnapshot([]),
      sessionId: sessionId ?? SESSION_TWO,
      composerSuggestions: buildInitialChatComposerSuggestions(persistedUiLocale),
    }),
  });

  const createResponse = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_TWO,
      uiLocale: "es_MX",
    }),
  });

  assert.equal(createResponse.status, 200);
  assert.equal(persistedUiLocale, "es-MX");
  assert.deepEqual(await createResponse.json(), {
    ok: true,
    sessionId: SESSION_TWO,
    composerSuggestions: buildInitialChatComposerSuggestions("es-MX"),
    chatConfig: createExpectedChatConfig(),
  });

  const readResponse = await app.request(`http://localhost/chat?sessionId=${SESSION_TWO}`);

  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), {
    sessionId: SESSION_TWO,
    conversationScopeId: SESSION_TWO,
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      messages: [],
    },
    composerSuggestions: buildInitialChatComposerSuggestions("es-MX"),
    chatConfig: createExpectedChatConfig(),
    activeRun: null,
  });
});

test("POST /chat/new returns a stable conflict when the requested session id is owned by another scope", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => null,
    createFreshChatSessionFn: async () => {
      throw createChatSessionRequestedSessionIdConflictError(SESSION_TWO);
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_TWO,
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Requested chat session id is already in use.",
    requestId: null,
    code: "CHAT_SESSION_ID_CONFLICT",
  });
});

test("POST /chat/new without sessionId preserves the legacy rollover behavior", async () => {
  const requestedSessionIds: Array<string | undefined> = [];
  let rolloverCallCount = 0;
  const rolloverUiLocales: Array<string | null> = [];
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => {
      requestedSessionIds.push(sessionId);
      if (sessionId === SESSION_TWO) {
        return {
          ...createSnapshot([]),
          sessionId: SESSION_TWO,
          composerSuggestions: buildInitialChatComposerSuggestions(undefined),
        };
      }

      return {
        ...createRunningSnapshot([]),
        composerSuggestions: buildInitialChatComposerSuggestions(undefined),
      };
    },
    rolloverToFreshChatSessionFn: async (_userId, _workspaceId, _previousSessionId, uiLocale) => {
      rolloverCallCount += 1;
      rolloverUiLocales.push(uiLocale);
      return SESSION_TWO;
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedSessionIds, [undefined, SESSION_TWO]);
  assert.equal(rolloverCallCount, 1);
  assert.deepEqual(rolloverUiLocales, [null]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: SESSION_TWO,
    composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new persists localized initial suggestions for rollover-created sessions", async () => {
  let persistedUiLocale: string | null = null;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => {
      if (sessionId === SESSION_TWO) {
        return {
          ...createSnapshot([]),
          sessionId: SESSION_TWO,
          composerSuggestions: buildInitialChatComposerSuggestions(persistedUiLocale),
        };
      }

      return {
        ...createSnapshot([{
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
          cursor: "1",
          itemId: null,
        }]),
        sessionId: SESSION_ONE,
        composerSuggestions: buildInitialChatComposerSuggestions(undefined),
      };
    },
    rolloverToFreshChatSessionFn: async (_userId, _workspaceId, previousSessionId, uiLocale) => {
      assert.equal(previousSessionId, SESSION_ONE);
      persistedUiLocale = uiLocale;
      return SESSION_TWO;
    },
  });

  const createResponse = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uiLocale: "de-DE",
    }),
  });

  assert.equal(createResponse.status, 200);
  assert.equal(persistedUiLocale, "de");
  assert.deepEqual(await createResponse.json(), {
    ok: true,
    sessionId: SESSION_TWO,
    composerSuggestions: buildInitialChatComposerSuggestions("de"),
    chatConfig: createExpectedChatConfig(),
  });

  const readResponse = await app.request(`http://localhost/chat?sessionId=${SESSION_TWO}`);

  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), {
    sessionId: SESSION_TWO,
    conversationScopeId: SESSION_TWO,
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      messages: [],
    },
    composerSuggestions: buildInitialChatComposerSuggestions("de"),
    chatConfig: createExpectedChatConfig(),
    activeRun: null,
  });
});

test("DELETE /chat is no longer routed", async () => {
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
  });

  const response = await app.request("http://localhost/chat", {
    method: "DELETE",
  });

  assert.equal(response.status, 404);
});

test("GET /chat prefers an explicit workspaceId query param over the legacy selected-workspace fallback", async () => {
  const requestedWorkspaceIds: string[] = [];
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContextWithSelectedWorkspace(LEGACY_WORKSPACE_ID),
    }),
    getRecoveredChatSessionSnapshotFn: async (_userId, workspaceId) => {
      requestedWorkspaceIds.push(workspaceId);
      return createSnapshot([]);
    },
  });

  const response = await app.request(
    `http://localhost/chat?sessionId=${SESSION_ONE}&workspaceId=${EXPLICIT_WORKSPACE_ID}`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(requestedWorkspaceIds, [EXPLICIT_WORKSPACE_ID]);
});

test("GET /chat preserves the legacy selected-workspace fallback when workspaceId is omitted", async () => {
  let requestedWorkspaceId: string | null = null;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContextWithSelectedWorkspace(LEGACY_WORKSPACE_ID),
    }),
    getRecoveredChatSessionSnapshotFn: async (_userId, workspaceId) => {
      requestedWorkspaceId = workspaceId;
      return createSnapshot([]);
    },
  });

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`);

  assert.equal(response.status, 200);
  assert.equal(requestedWorkspaceId, LEGACY_WORKSPACE_ID);
});

test("GET /chat returns assistant item ids in snapshot history and strips attachment payloads", async () => {
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    resolveLiveCursorFn: async () => null,
    getRecoveredChatSessionSnapshotFn: async () => createSnapshot([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1,
        isError: false,
        isStopped: false,
        cursor: "1",
        itemId: null,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          { type: "image", mediaType: "image/png", base64Data: "abc123" },
        ],
        timestamp: 2,
        isError: false,
        isStopped: false,
        cursor: "2",
        itemId: "assistant-item-1",
      },
    ]),
  });

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
          cursor: "1",
          itemId: null,
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "done" },
            { type: "image", mediaType: "image/png", base64Data: "" },
          ],
          timestamp: 2,
          isError: false,
          isStopped: false,
          cursor: "2",
          itemId: "assistant-item-1",
        },
      ],
    },
    composerSuggestions: [],
    chatConfig: createExpectedChatConfig(),
    activeRun: null,
  });
});

test("GET /chat returns a stable conflict when the requested session id is owned by another scope", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => {
      throw createChatSessionRequestedSessionIdConflictError(SESSION_TWO);
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_TWO}`);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Requested chat session id is already in use.",
    requestId: null,
    code: "CHAT_SESSION_ID_CONFLICT",
  });
});

test("GET /chat stops before store access when the selected workspace is no longer accessible", async () => {
  let snapshotRequested = false;
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    resolveAccessibleChatWorkspaceIdFn: async () => {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    },
    getRecoveredChatSessionSnapshotFn: async () => {
      snapshotRequested = true;
      return createSnapshot([]);
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`);

  assert.equal(snapshotRequested, false);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Workspace not found",
    requestId: null,
    code: "WORKSPACE_NOT_FOUND",
  });
});

test("GET /chat preserves card content parts in snapshot history", async () => {
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    resolveLiveCursorFn: async () => null,
    getRecoveredChatSessionSnapshotFn: async () => createSnapshot([
      {
        role: "user",
        content: [{
          type: "card",
          cardId: "card-1",
          frontText: "What is Rust?",
          backText: "A systems programming language.",
          tags: ["lang", "systems"],
          effortLevel: "medium",
        }],
        timestamp: 1,
        isError: false,
        isStopped: false,
        cursor: "1",
        itemId: null,
      },
    ]),
  });

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      messages: [
        {
          role: "user",
          content: [{
            type: "card",
            cardId: "card-1",
            frontText: "What is Rust?",
            backText: "A systems programming language.",
            tags: ["lang", "systems"],
            effortLevel: "medium",
          }],
          timestamp: 1,
          isError: false,
          isStopped: false,
          cursor: "1",
          itemId: null,
        },
      ],
    },
    composerSuggestions: [],
    chatConfig: createExpectedChatConfig(),
    activeRun: null,
  });
});

test("GET /chat paginated history returns assistant item ids and sanitized content", async () => {
  const paginatedSession: RecoveredPaginatedSession = {
    snapshot: createSnapshot([]),
    page: {
      newestCursor: "8",
      oldestCursor: "7",
      hasOlder: true,
      messages: [
        {
          sessionId: SESSION_ONE,
          itemId: "user-item-1",
          itemOrder: 7,
          role: "user",
          content: [{ type: "text", text: "hello" }],
          state: "completed",
          isError: false,
          isStopped: false,
          timestamp: 1,
          updatedAt: 1,
        },
        {
          sessionId: SESSION_ONE,
          itemId: "assistant-item-1",
          itemOrder: 8,
          role: "assistant",
          content: [{ type: "file", mediaType: "text/plain", base64Data: "abc123", fileName: "notes.txt" }],
          state: "completed",
          isError: false,
          isStopped: false,
          timestamp: 2,
          updatedAt: 2,
        },
      ],
    },
  };

  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredPaginatedSessionFn: async () => paginatedSession,
  });

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}&limit=2`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      hasOlder: true,
      oldestCursor: "7",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
          cursor: "7",
          itemId: null,
        },
        {
          role: "assistant",
          content: [{ type: "file", mediaType: "text/plain", base64Data: "", fileName: "notes.txt" }],
          timestamp: 2,
          isError: false,
          isStopped: false,
          cursor: "8",
          itemId: "assistant-item-1",
        },
      ],
    },
    composerSuggestions: [],
    chatConfig: createExpectedChatConfig(),
    activeRun: null,
  });
});

test("POST /chat can return an active run before the current turn appears in messages", async () => {
  let preparedClientRequestId: string | null = null;
  let preparedUiLocale: string | null = null;
  let invokeCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async (
      _userId,
      _workspaceId,
      requestedSessionId,
      content,
      clientRequestId,
      timezone,
      uiLocale,
    ) => {
      preparedClientRequestId = clientRequestId;
      preparedUiLocale = uiLocale;
      assert.equal(requestedSessionId, SESSION_ONE);
      assert.equal(content.length, 1);
      assert.equal(timezone, "Europe/Madrid");
      return {
        sessionId: SESSION_ONE,
        runId: "run-1",
        clientRequestId,
        runState: "running",
        deduplicated: true,
        shouldInvokeWorker: false,
      };
    },
    invokeChatWorkerFn: async () => {
      invokeCallCount += 1;
    },
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot([]),
    resolveLiveCursorFn: async () => null,
    listChatMessagesLatestFn: async () => ({
      messages: [{
        sessionId: SESSION_ONE,
        itemId: "assistant-item-1",
        itemOrder: 1,
        role: "assistant",
        content: [{ type: "text", text: "thinking" }],
        state: "in_progress",
        isError: false,
        isStopped: false,
        timestamp: 1,
        updatedAt: 1,
      }],
      oldestCursor: "1",
      newestCursor: "1",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => ({
      url: "https://chat-live.example.com",
      authorization: "Live test-token",
      expiresAt: 1_000,
    }),
  });

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "de-DE",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(preparedClientRequestId, "client-request-1");
  assert.equal(preparedUiLocale, "de");
  assert.equal(invokeCallCount, 0);
  assert.equal(response.headers.get("X-Chat-Request-Id"), "client-request-1");
  assert.deepEqual(await response.json(), {
    accepted: true,
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      messages: [],
    },
    activeRun: {
      runId: "run-1",
      status: "running",
      live: {
        cursor: null,
        stream: {
          url: "https://chat-live.example.com",
          authorization: "Live test-token",
          expiresAt: 1_000,
        },
      },
      lastHeartbeatAt: 1,
    },
    composerSuggestions: [],
    chatConfig: {
      ...createExpectedChatConfig(),
    },
    deduplicated: true,
  });
});

test("POST /chat rejects an inaccessible explicit workspaceId before preparing a run", async () => {
  let prepareChatRunRequested = false;
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContextWithSelectedWorkspace(LEGACY_WORKSPACE_ID),
    }),
    resolveAccessibleChatWorkspaceIdFn: async (_requestContext, explicitWorkspaceId) => {
      assert.equal(explicitWorkspaceId, EXPLICIT_WORKSPACE_ID);
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    },
    prepareChatRunFn: async () => {
      prepareChatRunRequested = true;
      throw new Error("prepareChatRunFn should not run");
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-explicit-workspace",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      workspaceId: EXPLICIT_WORKSPACE_ID,
    }),
  });

  assert.equal(prepareChatRunRequested, false);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Workspace not found",
    requestId: null,
    code: "WORKSPACE_NOT_FOUND",
  });
});

test("POST /chat without uiLocale preserves the legacy request contract", async () => {
  let preparedUiLocale: string | null = "unexpected";
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async (
      _userId,
      _workspaceId,
      requestedSessionId,
      content,
      clientRequestId,
      timezone,
      uiLocale,
    ) => {
      preparedUiLocale = uiLocale;
      assert.equal(requestedSessionId, SESSION_ONE);
      assert.equal(content.length, 1);
      assert.equal(clientRequestId, "legacy-client-request");
      assert.equal(timezone, "Europe/Madrid");
      return {
        sessionId: SESSION_ONE,
        runId: "run-legacy",
        clientRequestId,
        runState: "running",
        deduplicated: false,
        shouldInvokeWorker: false,
      };
    },
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot([]),
    resolveLiveCursorFn: async () => null,
    listChatMessagesLatestFn: async () => ({
      messages: [{
        sessionId: SESSION_ONE,
        itemId: "assistant-item-legacy",
        itemOrder: 1,
        role: "assistant",
        content: [{ type: "text", text: "thinking" }],
        state: "in_progress",
        isError: false,
        isStopped: false,
        timestamp: 1,
        updatedAt: 1,
      }],
      oldestCursor: "1",
      newestCursor: "1",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => ({
      url: "https://chat-live.example.com",
      authorization: "Live test-token",
      expiresAt: 1_000,
    }),
  });

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "legacy-client-request",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(preparedUiLocale, null);
  assert.equal(response.headers.get("X-Chat-Request-Id"), "legacy-client-request");
});

test("POST /chat maps active-run conflicts to a stable machine-readable code", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => {
      throw new ChatSessionConflictError(SESSION_ONE);
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-2",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("X-Chat-Request-Id"), "client-request-2");
  assert.deepEqual(await response.json(), {
    error: "Chat session already has an active response",
    requestId: null,
    code: "CHAT_ACTIVE_RUN_IN_PROGRESS",
  });
});

test("POST /chat/stop returns not found for an unknown explicit session id", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => null,
    requestChatRunCancellationFn: async () => {
      assert.fail("requestChatRunCancellation should not be called for an unknown session");
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/chat/stop", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_TWO,
    }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: `Chat session not found: ${SESSION_TWO}`,
    requestId: null,
    code: null,
  });
});

test("POST /chat/new uses an explicit workspaceId from JSON before the legacy selected-workspace fallback", async () => {
  const requestedWorkspaceIds: string[] = [];
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContextWithSelectedWorkspace(LEGACY_WORKSPACE_ID),
    }),
    getChatSessionIdFn: async (_userId, workspaceId) => {
      requestedWorkspaceIds.push(workspaceId);
      return SESSION_ONE;
    },
    getRecoveredChatSessionSnapshotFn: async () => ({
      ...createSnapshot([]),
      composerSuggestions: buildInitialChatComposerSuggestions(undefined),
    }),
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      workspaceId: EXPLICIT_WORKSPACE_ID,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedWorkspaceIds, [EXPLICIT_WORKSPACE_ID]);
});

test("POST /chat/stop uses an explicit workspaceId from JSON before the legacy selected-workspace fallback", async () => {
  const requestedWorkspaceIds: string[] = [];
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContextWithSelectedWorkspace(LEGACY_WORKSPACE_ID),
    }),
    getChatSessionIdFn: async (_userId, workspaceId) => {
      requestedWorkspaceIds.push(workspaceId);
      return SESSION_ONE;
    },
    requestChatRunCancellationFn: async (_userId, workspaceId, sessionId) => {
      requestedWorkspaceIds.push(workspaceId);
      return {
        sessionId,
        runId: "run-stop-1",
        stopped: true,
        stillRunning: false,
      };
    },
  });

  const response = await app.request("http://localhost/chat/stop", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      workspaceId: EXPLICIT_WORKSPACE_ID,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedWorkspaceIds, [EXPLICIT_WORKSPACE_ID, EXPLICIT_WORKSPACE_ID]);
  assert.deepEqual(await response.json(), {
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    runId: "run-stop-1",
    stopped: true,
    stillRunning: false,
  });
});
