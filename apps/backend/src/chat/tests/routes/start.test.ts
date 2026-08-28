import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { HttpError } from "../../../shared/errors";
import type { AppEnv } from "../../../server/app";
import type { BackendTraceCarrier } from "../../../observability/sentry";
import { createChatRoutes } from "../../../routes/chat";
import { ChatSessionConflictError } from "../../store";
import {
  EXPLICIT_WORKSPACE_ID,
  GUEST_SESSION_ID,
  GUEST_SUBJECT_USER_ID,
  LEGACY_WORKSPACE_ID,
  SESSION_ONE,
  createExpectedChatConfig,
  createGuestRequestContext,
  createRoutesWithHttpErrorJson,
  createRequestContext,
  createRequestContextWithSelectedWorkspace,
  createRunningSnapshot,
} from "./testSupport";

test("POST /chat can return an active run before the current turn appears in messages", async () => {
  let preparedClientRequestId: string | null = null;
  let preparedUiLocale: string | null = null;
  let invokeCallCount = 0;
  const aiMessageSentCalls: Array<Readonly<{
    userId: string;
    workspaceId: string;
    runId: string;
    subjectUserId: string;
    guestSessionId: string | null;
  }>> = [];
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    recordAiMessageSentAnalyticsFn: async (userId, workspaceId, runId, actor) => {
      aiMessageSentCalls.push({
        userId,
        workspaceId,
        runId,
        subjectUserId: actor.subjectUserId,
        guestSessionId: actor.guestSessionId,
      });
    },
    prepareChatRunFn: async (
      _userId,
      _workspaceId,
      requestedSessionId,
      content,
      clientRequestId,
      timezone,
      uiLocale,
      initiatingAuthIsSignedIn,
    ) => {
      preparedClientRequestId = clientRequestId;
      preparedUiLocale = uiLocale;
      assert.equal(requestedSessionId, SESSION_ONE);
      assert.equal(content.length, 1);
      assert.equal(timezone, "Europe/Madrid");
      // A bearer transport is signed-in auth.
      assert.equal(initiatingAuthIsSignedIn, true);
      return {
        sessionId: SESSION_ONE,
        runId: "run-1",
        clientRequestId,
        runState: "running",
        deduplicated: true,
        shouldInvokeWorker: false,
        initiatingAuthIsSignedIn: true,
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
  // A deduplicated replay dispatches no worker and still reports the turn; the id derived from
  // runId is what keeps storage at exactly one row.
  assert.deepEqual(aiMessageSentCalls, [{
    userId: "user-1",
    workspaceId: "workspace-1",
    runId: "run-1",
    subjectUserId: "user-1",
    guestSessionId: null,
  }]);
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


// Driven by a guest turn on purpose. The worker payload is workspace-scoped and keeps carrying
// `userId`, while the analytics actor has to name the sender: a route that rebuilt the actor from
// `userId`, or that stopped forwarding the guest session, would still satisfy every other
// assertion here, and a guest's AI-chat activity would stop resolving onto their account.
test("POST /chat dispatches worker without a route-supplied trace carrier", async () => {
  let workerInvocation: Readonly<{
    runId: string;
    userId: string;
    workspaceId: string;
    initiatingAuthIsSignedIn: boolean;
    routeRequestId?: string | null;
    chatRequestId?: string | null;
    sessionId?: string | null;
  }> | null = null;
  let workerInvocationIncludesTraceContext = true;
  let liveTraceContext: BackendTraceCarrier | null | undefined = undefined;
  const aiMessageSentCalls: Array<Readonly<{
    userId: string;
    workspaceId: string;
    runId: string;
    subjectUserId: string;
    guestSessionId: string | null;
  }>> = [];
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createGuestRequestContext(),
    }),
    recordAiMessageSentAnalyticsFn: async (userId, workspaceId, runId, actor) => {
      aiMessageSentCalls.push({
        userId,
        workspaceId,
        runId,
        subjectUserId: actor.subjectUserId,
        guestSessionId: actor.guestSessionId,
      });
    },
    prepareChatRunFn: async (
      _userId,
      _workspaceId,
      requestedSessionId,
      content,
      clientRequestId,
      timezone,
      uiLocale,
      initiatingAuthIsSignedIn,
    ) => {
      assert.equal(requestedSessionId, SESSION_ONE);
      assert.equal(content.length, 1);
      assert.equal(clientRequestId, "client-request-dispatch");
      assert.equal(timezone, "Europe/Madrid");
      assert.equal(uiLocale, null);
      // A guest transport is not signed-in auth.
      assert.equal(initiatingAuthIsSignedIn, false);
      return {
        sessionId: SESSION_ONE,
        runId: "run-dispatch",
        clientRequestId,
        runState: "running",
        deduplicated: false,
        shouldInvokeWorker: true,
        initiatingAuthIsSignedIn: false,
      };
    },
    invokeChatWorkerFn: async (payload) => {
      workerInvocation = payload;
      workerInvocationIncludesTraceContext = "traceContext" in payload;
    },
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot([]),
    resolveLiveCursorFn: async () => null,
    listChatMessagesLatestFn: async () => ({
      messages: [{
        sessionId: SESSION_ONE,
        itemId: "assistant-item-dispatch",
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
    createChatLiveStreamEnvelopeFn: async (
      _userId,
      _workspaceId,
      _sessionId,
      _runId,
      traceContext,
    ) => {
      liveTraceContext = traceContext;
      return {
        url: "https://chat-live.example.com",
        authorization: "Live test-token",
        expiresAt: 1_000,
      };
    },
  });
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "route-request-dispatch");
    await next();
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-dispatch",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(workerInvocation, {
    runId: "run-dispatch",
    userId: "user-1",
    workspaceId: "workspace-1",
    routeRequestId: "route-request-dispatch",
    chatRequestId: "client-request-dispatch",
    sessionId: SESSION_ONE,
    initiatingAuthIsSignedIn: false,
  });
  assert.equal(workerInvocationIncludesTraceContext, false);
  assert.notEqual(liveTraceContext, undefined);
  // Each identity field is pinned to a different value, so none of them can be satisfied by a
  // route that rebuilt the actor out of the workspace-scoped `userId` it already had.
  assert.deepEqual(aiMessageSentCalls, [{
    userId: "user-1",
    workspaceId: "workspace-1",
    runId: "run-dispatch",
    subjectUserId: GUEST_SUBJECT_USER_ID,
    guestSessionId: GUEST_SESSION_ID,
  }]);
});


// The `finally` around the dispatch exists for exactly this branch: the turn is already committed
// when the dispatch throws, so the event still has to report it. A refactor back to a plain
// sequential await passes every other assertion in this file and drops the event on every 500.
test("POST /chat reports the sent turn when the worker dispatch fails", async () => {
  let invokeCallCount = 0;
  let snapshotReadCount = 0;
  const aiMessageSentCalls: Array<Readonly<{
    userId: string;
    workspaceId: string;
    runId: string;
    subjectUserId: string;
    guestSessionId: string | null;
  }>> = [];
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createGuestRequestContext(),
    }),
    recordAiMessageSentAnalyticsFn: async (userId, workspaceId, runId, actor) => {
      aiMessageSentCalls.push({
        userId,
        workspaceId,
        runId,
        subjectUserId: actor.subjectUserId,
        guestSessionId: actor.guestSessionId,
      });
    },
    prepareChatRunFn: async () => ({
      sessionId: SESSION_ONE,
      runId: "run-dispatch-failed",
      clientRequestId: "client-request-dispatch-failed",
      runState: "running",
      deduplicated: false,
      shouldInvokeWorker: true,
      initiatingAuthIsSignedIn: false,
    }),
    invokeChatWorkerFn: async () => {
      invokeCallCount += 1;
      // `invokeChatWorkerOrPersistFailure` rethrows the dispatch error unchanged once it has
      // marked the run failed; only the message it persists carries a prefix.
      throw new Error("worker unreachable");
    },
    getRecoveredChatSessionSnapshotFn: async () => {
      snapshotReadCount += 1;
      throw new Error("the failed dispatch should have ended the request");
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
      clientRequestId: "client-request-dispatch-failed",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(invokeCallCount, 1);
  assert.equal(snapshotReadCount, 0);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Request failed. Try again.",
    requestId: null,
    code: "INTERNAL_ERROR",
  });
  assert.deepEqual(aiMessageSentCalls, [{
    userId: "user-1",
    workspaceId: "workspace-1",
    runId: "run-dispatch-failed",
    subjectUserId: GUEST_SUBJECT_USER_ID,
    guestSessionId: GUEST_SESSION_ID,
  }]);
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
    recordAiMessageSentAnalyticsFn: async () => {},
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
        initiatingAuthIsSignedIn: true,
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
