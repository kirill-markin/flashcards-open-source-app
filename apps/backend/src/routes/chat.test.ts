import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getChatConfig } from "../chat/config";
import { ChatSessionNotFoundError } from "../chat/store";
import { HttpError } from "../errors";
import type { RequestContext } from "../server/requestContext";
import {
  createChatRoutes,
  parseChatRequestBody,
  parseStopChatRequestBody,
} from "./chat";

function createChatTestApp(
  options: Readonly<{
    requestContext?: RequestContext;
    getRecoveredChatSessionSnapshotFn?: typeof import("../chat/runs").getRecoveredChatSessionSnapshot;
    createFreshChatSessionFn?: typeof import("../chat/store").createFreshChatSession;
    prepareChatRunFn?: typeof import("../chat/runs").prepareChatRun;
    invokeChatWorkerFn?: typeof import("../chat/workerInvoke").invokeChatWorkerOrPersistFailure;
    requestChatRunCancellationFn?: typeof import("../chat/runs").requestChatRunCancellation;
  }>,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as never);
      return context.json({ error: error.message, code: error.code });
    }

    throw error;
  });
  app.route("/", createChatRoutes({
    allowedOrigins: [],
    getRecoveredChatSessionSnapshotFn: options.getRecoveredChatSessionSnapshotFn,
    createFreshChatSessionFn: options.createFreshChatSessionFn,
    prepareChatRunFn: options.prepareChatRunFn,
    invokeChatWorkerFn: options.invokeChatWorkerFn,
    requestChatRunCancellationFn: options.requestChatRunCancellationFn,
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

test("parseChatRequestBody rejects unsupported request fields", () => {
  assert.throws(
    () => parseChatRequestBody({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      timezone: "Europe/Madrid",
      content: [{ type: "text", text: "hi" }],
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.message === "Unsupported request field: messages",
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

test("parseChatRequestBody accepts tool calls only through the new id field", () => {
  assert.deepEqual(
    parseChatRequestBody({
      sessionId: "session-1",
      timezone: "Europe/Madrid",
      content: [{
        type: "tool_call",
        id: "tool-1",
        name: "sql",
        status: "completed",
        input: "select 1",
        output: "[1]",
      }],
    }),
    {
      sessionId: "session-1",
      timezone: "Europe/Madrid",
      content: [{
        type: "tool_call",
        id: "tool-1",
        name: "sql",
        status: "completed",
        input: "select 1",
        output: "[1]",
      }],
    },
  );
});

test("parseChatRequestBody rejects the removed toolCallId field", () => {
  assert.throws(
    () => parseChatRequestBody({
      timezone: "Europe/Madrid",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "select 1",
        output: "[1]",
      }],
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.message === "content[0].id must be a string",
  );
});

test("new chat routes allow guest transport", async () => {
  const app = createChatTestApp({
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
    getRecoveredChatSessionSnapshotFn: async () => ({
      sessionId: "session-guest-1",
      runState: "idle",
      activeRunId: null,
      updatedAt: 1_742_811_200_000,
      activeRunHeartbeatAt: null,
      mainContentInvalidationVersion: 0,
      messages: [],
    }),
  });

  const response = await app.request("https://api.example.com/chat", {
    method: "GET",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: "session-guest-1",
    runState: "idle",
    updatedAt: 1_742_811_200_000,
    mainContentInvalidationVersion: 0,
    chatConfig: getChatConfig(),
    messages: [],
  });
});

test("new chat POST route prepares a persisted run and dispatches the worker", async () => {
  let invokedPayload: Readonly<Record<string, string>> | null = null;
  const app = createChatTestApp({
    prepareChatRunFn: async (userId, workspaceId, sessionId, content, requestId, timezone) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");
      assert.equal(requestId, "request-1");
      assert.equal(timezone, "Europe/Madrid");
      assert.deepEqual(content, [{ type: "text", text: "hi" }]);

      return {
        sessionId: "session-1",
        runId: "run-1",
      };
    },
    invokeChatWorkerFn: async (payload) => {
      invokedPayload = payload;
    },
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
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-1",
    runId: "run-1",
    runState: "running",
    chatConfig: getChatConfig(),
  });
  assert.deepEqual(invokedPayload, {
    runId: "run-1",
    userId: "user-1",
    workspaceId: "workspace-1",
  });
});

test("new chat GET route returns the recovered persisted snapshot", async () => {
  const app = createChatTestApp({
    getRecoveredChatSessionSnapshotFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");

      return {
        sessionId: "session-1",
        runState: "idle",
        activeRunId: null,
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
    chatConfig: getChatConfig(),
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
    getRecoveredChatSessionSnapshotFn: async () => {
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

test("new chat DELETE route keeps the current empty session", async () => {
  const app = createChatTestApp({
    getRecoveredChatSessionSnapshotFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, undefined);
      return {
        sessionId: "session-old",
        runState: "idle",
        activeRunId: null,
        updatedAt: 1,
        activeRunHeartbeatAt: null,
        mainContentInvalidationVersion: 0,
        messages: [],
      };
    },
    createFreshChatSessionFn: async () => {
      throw new Error("should not create a new session for an empty chat");
    },
  });

  const response = await app.request("https://api.example.com/chat", {
    method: "DELETE",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    sessionId: "session-old",
    chatConfig: getChatConfig(),
  });
});

test("new chat DELETE route creates a fresh session when the current session has messages", async () => {
  const app = createChatTestApp({
    getRecoveredChatSessionSnapshotFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, undefined);
      return {
        sessionId: "session-old",
        runState: "idle",
        activeRunId: null,
        updatedAt: 1,
        activeRunHeartbeatAt: null,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      };
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
    chatConfig: getChatConfig(),
  });
});

test("new chat stop route delegates to persisted run cancellation", async () => {
  const app = createChatTestApp({
    getRecoveredChatSessionSnapshotFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");

      return {
        sessionId: "session-1",
        runState: "running",
        activeRunId: "run-1",
        updatedAt: 1,
        activeRunHeartbeatAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      };
    },
    requestChatRunCancellationFn: async (userId, workspaceId, sessionId) => {
      assert.equal(userId, "user-1");
      assert.equal(workspaceId, "workspace-1");
      assert.equal(sessionId, "session-1");
      return {
        sessionId,
        runId: "run-1",
        stopped: true,
        stillRunning: true,
      };
    },
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
    runId: "run-1",
    stopped: true,
    stillRunning: true,
  });
});
