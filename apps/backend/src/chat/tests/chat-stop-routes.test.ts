import assert from "node:assert/strict";
import test from "node:test";
import { createChatRoutes } from "../../routes/chat";
import {
  EXPLICIT_WORKSPACE_ID,
  LEGACY_WORKSPACE_ID,
  RUN_ONE,
  SESSION_ONE,
  SESSION_TWO,
  createRequestContext,
  createRoutesWithHttpErrorJson,
  createRequestContextWithSelectedWorkspace,
} from "./chat-routes-test-support";

test("POST /chat/stop returns not found for an unknown explicit session id", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => null,
    requestChatRunCancellationFn: async () => {
      assert.fail("requestChatRunCancellation should not be called for an unknown session");
    },
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request("http://localhost/chat/stop", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_TWO,
    }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: `Chat session not found: ${SESSION_TWO}`,
    requestId: null,
    code: null,
  });
});


test("POST /chat/stop uses an explicit workspaceId from JSON before the legacy selected-workspace fallback", async () => {
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
    requestChatRunCancellationFn: async (_userId, workspaceId, sessionId, expectedRunId) => {
      requestedWorkspaceIds.push(workspaceId);
      assert.equal(expectedRunId, null);
      return {
        sessionId,
        runId: "run-stop-1",
        stopped: true,
        stillRunning: false,
      };
    },
  });

  const response = await app.request("http://localhost/chat/stop", {
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
  assert.deepEqual(requestedWorkspaceIds, [EXPLICIT_WORKSPACE_ID, EXPLICIT_WORKSPACE_ID]);
  assert.deepEqual(await response.json(), {
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    runId: "run-stop-1",
    stopped: true,
    stillRunning: false,
  });
});


test("POST /chat/stop passes the expected runId when the client provides it", async () => {
  let requestedRunId: string | null = null;
  const app = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getChatSessionIdFn: async () => SESSION_ONE,
    requestChatRunCancellationFn: async (_userId, _workspaceId, sessionId, expectedRunId) => {
      requestedRunId = expectedRunId;
      return {
        sessionId,
        runId: expectedRunId,
        stopped: true,
        stillRunning: true,
      };
    },
  });

  const response = await app.request("http://localhost/chat/stop", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      runId: RUN_ONE,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(requestedRunId, RUN_ONE);
  assert.deepEqual(await response.json(), {
    sessionId: SESSION_ONE,
    conversationScopeId: SESSION_ONE,
    runId: RUN_ONE,
    stopped: true,
    stillRunning: true,
  });
});
