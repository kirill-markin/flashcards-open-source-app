import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import {
  CHAT_LIVE_RUN_ID_REQUIRED_CODE,
  createChatLiveErrorResponse,
} from "./chat/liveErrors";
import { handleLiveRequest } from "./chat/liveRequest";

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
