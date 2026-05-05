import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../errors";
import { createChatRoutes } from "../../routes/chat";
import { createChatSessionRequestedSessionIdConflictError } from "../errors";
import type { RecoveredPaginatedSession } from "../runs";
import {
  EXPLICIT_WORKSPACE_ID,
  LEGACY_WORKSPACE_ID,
  SESSION_ONE,
  SESSION_TWO,
  createExpectedChatConfig,
  createRoutesWithHttpErrorJson,
  createRequestContext,
  createRequestContextWithSelectedWorkspace,
  createSnapshot,
} from "./chat-routes-test-support";

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
  const app = createRoutesWithHttpErrorJson();
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
  const app = createRoutesWithHttpErrorJson();
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

