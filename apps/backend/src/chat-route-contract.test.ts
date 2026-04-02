import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./errors";
import { createChatRoutes } from "./routes/chat";
import type { RequestContext } from "./server/requestContext";
import type { ChatSessionSnapshot, PersistedChatMessageItem } from "./chat/store";

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

function createRoutesWithHttpErrorJson() {
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
  return app;
}

function createRunningSnapshot(): ChatSessionSnapshot {
  return {
    sessionId: "session-1",
    runState: "running",
    activeRunId: "run-1",
    updatedAt: 1,
    activeRunHeartbeatAt: 1,
    mainContentInvalidationVersion: 0,
    messages: [],
  };
}

function createAssistantItem(
  state: PersistedChatMessageItem["state"],
): PersistedChatMessageItem {
  return {
    itemId: "assistant-1",
    sessionId: "session-1",
    itemOrder: 6,
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    state,
    isError: false,
    isStopped: false,
    timestamp: 1,
    updatedAt: 1,
  };
}

test("GET /chat fails with a stable contract code when running snapshot has no in-progress assistant item", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("completed")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request("http://localhost/chat?sessionId=session-1", {
    headers: {
      "X-Chat-Resume-Attempt-Id": "resume-1",
      "X-Client-Platform": "web",
      "X-Client-Version": "web-test",
    },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Chat live resume contract violation",
    requestId: null,
    code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
  });
});

test("GET /chat fails with a stable contract code when a running snapshot cannot create a live stream", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    resolveLiveCursorFn: async () => "5",
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("in_progress")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => null as never,
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request("http://localhost/chat?sessionId=session-1");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Chat live resume contract violation",
    requestId: null,
    code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
  });
});

test("POST /chat fails with a stable contract code when a running response cannot create a live stream", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => ({
      sessionId: "session-1",
      runId: "run-1",
      clientRequestId: "client-request-1",
      runState: "running",
      deduplicated: false,
      shouldInvokeWorker: false,
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    resolveLiveCursorFn: async () => "5",
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("in_progress")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => null as never,
    interruptPreparedChatRunFn: async () => undefined,
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

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

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Chat live resume contract violation",
    requestId: null,
    code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
  });
});
