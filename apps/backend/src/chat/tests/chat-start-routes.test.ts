import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../errors";
import { createChatRoutes } from "../../routes/chat";
import { ChatSessionConflictError } from "../store";
import {
  EXPLICIT_WORKSPACE_ID,
  LEGACY_WORKSPACE_ID,
  SESSION_ONE,
  createExpectedChatConfig,
  createRoutesWithHttpErrorJson,
  createRequestContext,
  createRequestContextWithSelectedWorkspace,
  createRunningSnapshot,
} from "./chat-routes-test-support";

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
  const app = createRoutesWithHttpErrorJson();
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
  const app = createRoutesWithHttpErrorJson();
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

