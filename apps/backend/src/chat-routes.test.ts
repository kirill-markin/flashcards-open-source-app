import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./errors";
import { createChatRoutes } from "./routes/chat";
import type { ChatSessionSnapshot } from "./chat/store";
import { ChatSessionConflictError } from "./chat/store";
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
    mainContentInvalidationVersion: 0,
    messages,
  };
}

test("POST /chat/new returns the current session when history is empty", async () => {
  let createFreshChatSessionCallCount = 0;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => createSnapshot([]),
    createFreshChatSessionFn: async () => {
      createFreshChatSessionCallCount += 1;
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
  assert.equal(createFreshChatSessionCallCount, 0);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-1",
    chatConfig: {
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
    },
  });
});

test("POST /chat/new creates a fresh session when history is not empty", async () => {
  let requestedSessionId: string | undefined;
  let createFreshChatSessionCallCount = 0;
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
      requestedSessionId = sessionId;
      return createSnapshot([{
        role: "user",
        content: [{
          type: "text",
          text: "hello",
        }],
        timestamp: 1,
        isError: false,
        isStopped: false,
      }]);
    },
    createFreshChatSessionFn: async () => {
      createFreshChatSessionCallCount += 1;
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
  assert.equal(requestedSessionId, "session-1");
  assert.equal(createFreshChatSessionCallCount, 1);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-2",
    chatConfig: {
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
    },
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
    ok: true,
    sessionId: "session-1",
    runId: "run-1",
    clientRequestId: "client-request-1",
    runState: "running",
    chatConfig: {
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
