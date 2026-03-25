import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { ChatSessionNotFoundError } from "../chat/store";
import type { ChatStreamEvent } from "../chat/types";
import { HttpError } from "../errors";
import type { RequestContext } from "../server/requestContext";
import {
  createChatEventStream,
  createChatRoutes,
  parseChatRequestBody,
  parseStopChatRequestBody,
} from "./chat";

function createChatTestApp(
  options: Readonly<{
    enabled?: boolean;
    requestContext?: RequestContext;
    getChatSessionSnapshotFn?: typeof import("../chat/store").getChatSessionSnapshot;
    getLatestChatSessionIdFn?: typeof import("../chat/store").getLatestChatSessionId;
    createFreshChatSessionFn?: typeof import("../chat/store").createFreshChatSession;
    prepareChatRunFn?: typeof import("../chat/store").prepareChatRun;
    startPersistedChatRunFn?: typeof import("../chat/runtime").startPersistedChatRun;
    stopActiveChatRunFn?: typeof import("../chat/runtime").stopActiveChatRun;
    cancelActiveChatRunByUserFn?: typeof import("../chat/store").cancelActiveChatRunByUser;
    markActiveChatRunCancellationPersistedFn?: typeof import("../chat/runtime").markActiveChatRunCancellationPersisted;
    hasActiveChatRunFn?: typeof import("../chat/runtime").hasActiveChatRun;
  }>,
): Hono {
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as never);
      return context.json({ error: error.message, code: error.code });
    }

    throw error;
  });
  app.route("/", createChatRoutes({
    allowedOrigins: [],
    enabled: options.enabled,
    getChatSessionSnapshotFn: options.getChatSessionSnapshotFn,
    getLatestChatSessionIdFn: options.getLatestChatSessionIdFn,
    createFreshChatSessionFn: options.createFreshChatSessionFn,
    prepareChatRunFn: options.prepareChatRunFn,
    startPersistedChatRunFn: options.startPersistedChatRunFn,
    stopActiveChatRunFn: options.stopActiveChatRunFn,
    cancelActiveChatRunByUserFn: options.cancelActiveChatRunByUserFn,
    markActiveChatRunCancellationPersistedFn: options.markActiveChatRunCancellationPersistedFn,
    hasActiveChatRunFn: options.hasActiveChatRunFn,
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext: {
        ...(options.requestContext ?? {
          userId: "user-1",
          subjectUserId: "user-1",
          selectedWorkspaceId: "workspace-1",
          email: "user@example.com",
          locale: "en",
          userSettingsCreatedAt: "2026-03-12T10:00:00.000Z",
          transport: "session",
          connectionId: null,
        }),
      },
    }),
  }));
  return app;
}

async function readSseEvents(response: Response): Promise<ReadonlyArray<ChatStreamEvent>> {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ChatStreamEvent);
}

test("parseChatRequestBody rejects legacy chat fields", () => {
  assert.throws(
    () => parseChatRequestBody({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      timezone: "Europe/Madrid",
      content: [{ type: "text", text: "hi" }],
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.message === "Unsupported legacy chat field: messages",
  );
});

test("parseStopChatRequestBody requires a non-empty sessionId", () => {
  assert.throws(
    () => parseStopChatRequestBody({ sessionId: "" }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.message === "sessionId must not be empty",
  );
});

test("new chat routes stay hidden while the feature gate is disabled", async () => {
  const app = createChatTestApp({ enabled: false });

  const response = await app.request("https://api.example.com/chat", {
    method: "GET",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Not found",
    code: "AI_CHAT_V2_DISABLED",
  });
});

test("new chat routes reject guest transport even when enabled", async () => {
  const app = createChatTestApp({
    enabled: true,
    requestContext: {
      userId: "guest-user-1",
      subjectUserId: "guest-user-1",
      selectedWorkspaceId: "workspace-1",
      email: null,
      locale: "en",
      userSettingsCreatedAt: "2026-03-12T10:00:00.000Z",
      transport: "guest",
      connectionId: null,
    },
  });

  const response = await app.request("https://api.example.com/chat", {
    method: "POST",
    body: JSON.stringify({
      content: [{ type: "text", text: "hi" }],
      timezone: "Europe/Madrid",
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Bearer or session authentication.",
    code: "AI_CHAT_V2_HUMAN_AUTH_REQUIRED",
  });
});

test("new chat routes accept the server-owned request shape and stream the new backend-owned response", async () => {
  const app = createChatTestApp({
    enabled: true,
    prepareChatRunFn: async (userId, workspaceId, sessionId, content) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");
      assert.deepEqual(content, [{ type: "text", text: "hi" }]);

      return {
        sessionId: "session-1",
        assistantItem: {
          itemId: "assistant-1",
          sessionId: "session-1",
          role: "assistant",
          content: [],
          state: "in_progress",
          isError: false,
          isStopped: false,
          timestamp: 1,
          updatedAt: 1,
        },
        localMessages: [{
          role: "user",
          content: [{ type: "text", text: "hi" }],
        }],
        turnInput: [{ type: "text", text: "hi" }],
      };
    },
    startPersistedChatRunFn: () =>
      (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield {
          type: "delta",
          text: "hello",
          itemId: "item-1",
          outputIndex: 0,
          contentIndex: 0,
          sequenceNumber: 1,
        };
        yield { type: "done" };
      })(),
  });

  const response = await app.request("https://api.example.com/chat", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "session-1",
      content: [{ type: "text", text: "hi" }],
      timezone: "Europe/Madrid",
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("x-chat-session-id"), "session-1");
  assert.deepEqual(await readSseEvents(response), [
    {
      type: "delta",
      text: "hello",
      itemId: "item-1",
      outputIndex: 0,
      contentIndex: 0,
      sequenceNumber: 1,
    },
    { type: "done" },
  ]);
});

test("new chat GET route returns the persisted snapshot", async () => {
  const app = createChatTestApp({
    enabled: true,
    getChatSessionSnapshotFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");

      return {
        sessionId: "session-1",
        runState: "idle",
        updatedAt: 1_742_811_200_000,
        activeRunHeartbeatAt: null,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Stored answer" }],
          timestamp: 1_742_811_200_000,
          isError: false,
          isStopped: false,
        }],
      };
    },
  });

  const response = await app.request("https://api.example.com/chat?sessionId=session-1", {
    method: "GET",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: "session-1",
    runState: "idle",
    updatedAt: 1_742_811_200_000,
    mainContentInvalidationVersion: 0,
    messages: [{
      role: "assistant",
      content: [{ type: "text", text: "Stored answer" }],
      timestamp: 1_742_811_200_000,
      isError: false,
      isStopped: false,
    }],
  });
});

test("new chat GET route maps missing sessions to 404", async () => {
  const app = createChatTestApp({
    enabled: true,
    getChatSessionSnapshotFn: async () => {
      throw new ChatSessionNotFoundError("session-404");
    },
  });

  const response = await app.request("https://api.example.com/chat?sessionId=session-404", {
    method: "GET",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Chat session not found: session-404",
    code: null,
  });
});

test("new chat DELETE route creates a fresh empty session", async () => {
  const app = createChatTestApp({
    enabled: true,
    getLatestChatSessionIdFn: async (userId, workspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      return "session-old";
    },
    createFreshChatSessionFn: async (userId, workspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      return "session-new";
    },
  });

  const response = await app.request("https://api.example.com/chat", {
    method: "DELETE",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-new",
  });
});

test("new chat stop route validates the new stop contract and returns stop state", async () => {
  const app = createChatTestApp({
    enabled: true,
    getChatSessionSnapshotFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");

      return {
        sessionId: "session-1",
        runState: "running",
        updatedAt: 1,
        activeRunHeartbeatAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      };
    },
    stopActiveChatRunFn: (sessionId) => {
      assert.equal(sessionId, "session-1");
      return true;
    },
    cancelActiveChatRunByUserFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");
      return true;
    },
    markActiveChatRunCancellationPersistedFn: (sessionId) => {
      assert.equal(sessionId, "session-1");
    },
    hasActiveChatRunFn: () => false,
  });

  const response = await app.request("https://api.example.com/chat/stop", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "session-1",
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-1",
    stopped: true,
    stillRunning: false,
  });
});

test("createChatEventStream emits SSE chunks and heartbeats safely", async () => {
  const stream = createChatEventStream({
    events: (async function* (): AsyncGenerator<ChatStreamEvent> {
      yield {
        type: "delta",
        text: "hello",
        itemId: "item-1",
        outputIndex: 0,
        contentIndex: 0,
        sequenceNumber: 1,
      };
      yield { type: "done" };
    })(),
    heartbeatIntervalMs: 1,
    onStreamError: () => undefined,
  });

  const response = new Response(stream);
  assert.deepEqual(await readSseEvents(response), [
    {
      type: "delta",
      text: "hello",
      itemId: "item-1",
      outputIndex: 0,
      contentIndex: 0,
      sequenceNumber: 1,
    },
    { type: "done" },
  ]);
});
