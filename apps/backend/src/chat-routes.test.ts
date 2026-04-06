import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./errors";
import { createChatRoutes } from "./routes/chat";
import { buildInitialChatComposerSuggestions } from "./chat/composerSuggestions";
import type { ChatSessionSnapshot } from "./chat/store";
import { ChatSessionConflictError } from "./chat/store";
import type { RecoveredPaginatedSession } from "./chat/runs";
import type { RequestContext } from "./server/requestContext";

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

function createSnapshot(messages: ChatSessionSnapshot["messages"]): ChatSessionSnapshot {
  return {
    sessionId: "session-1",
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
    sessionId: "session-1",
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

test("POST /chat/new returns the current session when history is empty", async () => {
  let rolloverCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => ({
      ...createSnapshot([]),
      composerSuggestions: buildInitialChatComposerSuggestions(),
    }),
    rolloverToFreshChatSessionFn: async () => {
      rolloverCallCount += 1;
      return "session-2";
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "session-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(rolloverCallCount, 0);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-1",
    composerSuggestions: buildInitialChatComposerSuggestions(),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new creates a fresh session when history is not empty", async () => {
  const requestedSessionIds: Array<string | undefined> = [];
  let rolloverCallCount = 0;
  let rolledOverSessionId: string | null = null;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async (
      _userId: string,
      _workspaceId: string,
      sessionId?: string,
    ) => {
      requestedSessionIds.push(sessionId);
      if (sessionId === "session-2") {
        return {
          ...createSnapshot([]),
          sessionId: "session-2",
          composerSuggestions: buildInitialChatComposerSuggestions(),
        };
      }

      return {
        ...createRunningSnapshot([]),
        composerSuggestions: buildInitialChatComposerSuggestions(),
      };
    },
    rolloverToFreshChatSessionFn: async (
      _userId: string,
      _workspaceId: string,
      sessionId: string,
    ) => {
      rolloverCallCount += 1;
      rolledOverSessionId = sessionId;
      return "session-2";
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "session-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedSessionIds, ["session-1", "session-2"]);
  assert.equal(rolloverCallCount, 1);
  assert.equal(rolledOverSessionId, "session-1");
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-2",
    composerSuggestions: buildInitialChatComposerSuggestions(),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new creates a fresh session when run state is active even if history is empty", async () => {
  let rolloverCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async (
      _userId: string,
      _workspaceId: string,
      sessionId?: string,
    ) => {
      if (sessionId === "session-2") {
        return {
          ...createSnapshot([]),
          sessionId: "session-2",
          composerSuggestions: buildInitialChatComposerSuggestions(),
        };
      }

      return {
        ...createRunningSnapshot([]),
        composerSuggestions: buildInitialChatComposerSuggestions(),
      };
    },
    rolloverToFreshChatSessionFn: async () => {
      rolloverCallCount += 1;
      return "session-2";
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "session-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(rolloverCallCount, 1);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-2",
    composerSuggestions: buildInitialChatComposerSuggestions(),
    chatConfig: createExpectedChatConfig(),
  });
});

test("POST /chat/new creates a fresh session when forceFresh is true even if history is empty and idle", async () => {
  let rolloverCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async (
      _userId: string,
      _workspaceId: string,
      sessionId?: string,
    ) => {
      if (sessionId === "session-2") {
        return {
          ...createSnapshot([]),
          sessionId: "session-2",
          composerSuggestions: buildInitialChatComposerSuggestions(),
        };
      }

      return {
        ...createSnapshot([]),
        composerSuggestions: buildInitialChatComposerSuggestions(),
      };
    },
    rolloverToFreshChatSessionFn: async () => {
      rolloverCallCount += 1;
      return "session-2";
    },
  });

  const response = await app.request("http://localhost/chat/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "session-1",
      forceFresh: true,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(rolloverCallCount, 1);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-2",
    composerSuggestions: buildInitialChatComposerSuggestions(),
    chatConfig: createExpectedChatConfig(),
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

  const response = await app.request("http://localhost/chat?sessionId=session-1");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: "session-1",
    conversationScopeId: "session-1",
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

  const response = await app.request("http://localhost/chat?sessionId=session-1");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: "session-1",
    conversationScopeId: "session-1",
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
          sessionId: "session-1",
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
          sessionId: "session-1",
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

  const response = await app.request("http://localhost/chat?sessionId=session-1&limit=2");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: "session-1",
    conversationScopeId: "session-1",
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

test("POST /chat returns the canonical chat request id header and dedupe metadata", async () => {
  let preparedClientRequestId: string | null = null;
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
    ) => {
      preparedClientRequestId = clientRequestId;
      assert.equal(requestedSessionId, "session-1");
      assert.equal(content.length, 1);
      assert.equal(timezone, "Europe/Madrid");
      return {
        sessionId: "session-1",
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
        sessionId: "session-1",
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
      sessionId: "session-1",
      clientRequestId: "client-request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(preparedClientRequestId, "client-request-1");
  assert.equal(invokeCallCount, 0);
  assert.equal(response.headers.get("X-Chat-Request-Id"), "client-request-1");
  assert.deepEqual(await response.json(), {
    accepted: true,
    sessionId: "session-1",
    conversationScopeId: "session-1",
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

test("POST /chat maps active-run conflicts to a stable machine-readable code", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => {
      throw new ChatSessionConflictError("session-1");
    },
  });
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId: null,
        code: error.code,
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
      sessionId: "session-1",
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
