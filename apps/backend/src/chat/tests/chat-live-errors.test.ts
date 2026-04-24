import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../errors";
import {
  CHAT_LIVE_RUN_ID_REQUIRED_CODE,
  createChatLiveErrorResponse,
} from "../liveErrors";
import { handleLiveRequest } from "../liveRequest";

const EXPLICIT_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

test("handleLiveRequest rejects a live attach request without runId using a stable error code", async () => {
  await assert.rejects(
    async () => handleLiveRequest(
      new URL("https://chat-live.example.com/?sessionId=session-1&afterCursor=5"),
      "Live token",
      {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, CHAT_LIVE_RUN_ID_REQUIRED_CODE);
      assert.equal(error.message, "AI live stream request is missing runId.");
      return true;
    },
  );
});

test("handleLiveRequest rejects a signed live token when the run is no longer accessible", async () => {
  await assert.rejects(
    async () => handleLiveRequest(
      new URL("https://chat-live.example.com/?sessionId=session-1&runId=run-1"),
      "Live token",
      {},
      {
        authenticateRequestFn: async () => {
          throw new Error("authenticateRequestFn should not run for Live auth");
        },
        ensureUserProfileFn: async () => {
          throw new Error("ensureUserProfileFn should not run for Live auth");
        },
        verifyChatLiveAuthorizationHeaderFn: async () => ({
          userId: "user-1",
          workspaceId: "workspace-1",
          sessionId: "session-1",
          runId: "run-1",
        }),
        resolveAccessibleChatWorkspaceIdFn: async () => "workspace-1",
        assertChatLiveRunAccessFn: async () => {
          throw new HttpError(404, "Chat live stream not found.", "CHAT_LIVE_NOT_FOUND");
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "CHAT_LIVE_NOT_FOUND");
      assert.equal(error.message, "Chat live stream not found.");
      return true;
    },
  );
});

test("handleLiveRequest prefers an explicit workspaceId for non-Live auth fallback", async () => {
  let assertedWorkspaceId: string | null = null;

  const result = await handleLiveRequest(
    new URL(`https://chat-live.example.com/?sessionId=session-1&runId=run-1&workspaceId=${EXPLICIT_WORKSPACE_ID}`),
    "Bearer test-token",
    {
      "X-Chat-Resume-Attempt-Id": "resume-1",
      "X-Client-Platform": "web",
      "X-Client-Version": "web-test",
    },
    {
      authenticateRequestFn: async () => ({
        userId: "user-1",
        email: null,
        cognitoUsername: null,
        subjectUserId: "user-1",
        transport: "bearer",
        connectionId: null,
        selectedWorkspaceId: null,
      }),
      ensureUserProfileFn: async () => ({
        userId: "user-1",
        selectedWorkspaceId: "workspace-legacy",
        email: null,
        locale: "en",
        createdAt: "2026-03-30T00:00:00.000Z",
      }),
      verifyChatLiveAuthorizationHeaderFn: async () => {
        throw new Error("verifyChatLiveAuthorizationHeaderFn should not run for Bearer auth");
      },
      resolveAccessibleChatWorkspaceIdFn: async (requestContext, explicitWorkspaceId) => {
        assert.equal(requestContext.selectedWorkspaceId, "workspace-legacy");
        assert.equal(explicitWorkspaceId, EXPLICIT_WORKSPACE_ID);
        if (explicitWorkspaceId === undefined) {
          throw new Error("explicitWorkspaceId should be defined");
        }

        return explicitWorkspaceId;
      },
      assertChatLiveRunAccessFn: async (_userId, workspaceId) => {
        assertedWorkspaceId = workspaceId;
      },
    },
  );

  assert.equal(assertedWorkspaceId, EXPLICIT_WORKSPACE_ID);
  assert.deepEqual(result, {
    sessionId: "session-1",
    runId: "run-1",
    afterCursor: undefined,
    userId: "user-1",
    workspaceId: EXPLICIT_WORKSPACE_ID,
    resumeAttemptId: "resume-1",
    clientPlatform: "web",
    clientVersion: "web-test",
  });
});

test("createChatLiveErrorResponse returns a request id and stable code for HttpError failures", () => {
  const response = createChatLiveErrorResponse(
    new HttpError(400, "AI live stream request is missing runId.", CHAT_LIVE_RUN_ID_REQUIRED_CODE),
    "request-1",
  );

  assert.deepEqual(response, {
    statusCode: 400,
    body: {
      error: "AI live stream request is missing runId.",
      requestId: "request-1",
      code: CHAT_LIVE_RUN_ID_REQUIRED_CODE,
    },
  });
});
