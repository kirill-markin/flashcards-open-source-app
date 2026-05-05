import assert from "node:assert/strict";
import test from "node:test";
import { createChatRoutes } from "../../routes/chat";
import { buildInitialChatComposerSuggestions } from "../composerSuggestions";
import { createChatSessionRequestedSessionIdConflictError } from "../errors";
import {
  EXPLICIT_WORKSPACE_ID,
  LEGACY_WORKSPACE_ID,
  SESSION_ONE,
  SESSION_TWO,
  createExpectedChatConfig,
  createRoutesWithHttpErrorJson,
  createRequestContext,
  createRequestContextWithSelectedWorkspace,
  createRunningSnapshot,
  createSnapshot,
} from "./chat-routes-test-support";

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
  const app = createRoutesWithHttpErrorJson();
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
  const app = createRoutesWithHttpErrorJson();
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

