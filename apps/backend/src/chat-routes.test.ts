import assert from "node:assert/strict";
import test from "node:test";
import { createChatRoutes } from "./routes/chat";
import type { ChatSessionSnapshot } from "./chat/store";
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
