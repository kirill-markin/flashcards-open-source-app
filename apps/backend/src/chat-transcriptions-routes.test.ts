import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createChatSessionRequestedSessionIdConflictError } from "./chat/errors";
import { HttpError } from "./errors";
import { createChatTranscriptionsRoutes } from "./routes/chatTranscriptions";
import type { RequestContext } from "./server/requestContext";

const SESSION_ONE = "11111111-1111-4111-8111-111111111111";

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

function toHttpErrorLike(error: unknown): { statusCode: number; message: string; code: string | null } | null {
  if (error instanceof HttpError) {
    return error;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const message = "message" in error ? error.message : undefined;
  const code = "code" in error ? error.code : undefined;
  if (typeof statusCode !== "number" || typeof message !== "string" || (typeof code !== "string" && code !== null)) {
    return null;
  }

  return { statusCode, message, code };
}

test("POST /chat/transcriptions resolves the explicit sessionId exactly once", async () => {
  const requestedSessionIds: Array<string | undefined> = [];
  const app = createChatTranscriptionsRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => {
      requestedSessionIds.push(sessionId);
      return {
        sessionId: sessionId ?? SESSION_ONE,
        runState: "idle",
        activeRunId: null,
        updatedAt: 1,
        activeRunHeartbeatAt: null,
        composerSuggestions: [],
        mainContentInvalidationVersion: 0,
        messages: [],
      };
    },
    transcribeAudioFn: async () => "hello",
  });

  const formData = new FormData();
  formData.set("file", new File(["audio"], "note.m4a", { type: "audio/m4a" }));
  formData.set("source", "web");
  formData.set("sessionId", SESSION_ONE);

  const response = await app.request("http://localhost/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedSessionIds, [SESSION_ONE]);
  assert.deepEqual(await response.json(), {
    text: "hello",
    sessionId: SESSION_ONE,
  });
});

test("POST /chat/transcriptions returns a stable conflict when the requested session id is owned by another scope", async () => {
  const routes = createChatTranscriptionsRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => {
      throw createChatSessionRequestedSessionIdConflictError(SESSION_ONE);
    },
    transcribeAudioFn: async () => "hello",
  });
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", routes);

  const formData = new FormData();
  formData.set("file", new File(["audio"], "note.m4a", { type: "audio/m4a" }));
  formData.set("source", "web");
  formData.set("sessionId", SESSION_ONE);

  const response = await app.request("http://localhost/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Requested chat session id is already in use.",
    requestId: null,
    code: "CHAT_SESSION_ID_CONFLICT",
  });
});
