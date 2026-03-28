import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ChatSessionNotFoundError } from "../chat/store";
import { HttpError } from "../errors";
import type { RequestContext } from "../server/requestContext";
import { createChatTranscriptionsRoutes } from "./chatTranscriptions";

function createChatTranscriptionsTestApp(
  options: Readonly<{
    requestContext?: RequestContext;
    getRecoveredChatSessionSnapshotFn?: Parameters<typeof createChatTranscriptionsRoutes>[0]["getRecoveredChatSessionSnapshotFn"];
    transcribeAudioFn: Parameters<typeof createChatTranscriptionsRoutes>[0]["transcribeAudioFn"];
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
  app.route("/", createChatTranscriptionsRoutes({
    allowedOrigins: [],
    getRecoveredChatSessionSnapshotFn: options.getRecoveredChatSessionSnapshotFn ?? (async (_userId, _workspaceId, sessionId) => ({
      sessionId: sessionId ?? "session-1",
      runState: "idle",
      activeRunId: null,
      updatedAt: 1,
      activeRunHeartbeatAt: null,
      mainContentInvalidationVersion: 0,
      messages: [],
    })),
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
          transport: "bearer",
          connectionId: null,
        }),
      },
    }),
    transcribeAudioFn: options.transcribeAudioFn,
  }));
  return app;
}

test("chat transcriptions route accepts multipart uploads without durationSeconds and returns text", async () => {
  let observedSource: string | null = null;
  let observedFileName: string | null = null;
  let observedRequestId: string | null = null;
  let observedSessionId: string | null = null;
  const app = createChatTranscriptionsTestApp({
    getRecoveredChatSessionSnapshotFn: async () => ({
      sessionId: "session-1",
      runState: "idle",
      activeRunId: null,
      updatedAt: 1,
      activeRunHeartbeatAt: null,
      mainContentInvalidationVersion: 0,
      messages: [],
    }),
    transcribeAudioFn: async (upload, requestContext) => {
      observedSource = upload.source;
      observedFileName = upload.file.name;
      observedRequestId = requestContext.requestId;
      observedSessionId = requestContext.sessionId;
      return "recognized text";
    },
  });

  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.webm", { type: "audio/webm" }));
  formData.append("source", "web");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "recognized text", sessionId: "session-1" });
  assert.equal(observedSource, "web");
  assert.equal(observedFileName, "clip.webm");
  assert.equal(observedRequestId, "request-1");
  assert.equal(observedSessionId, "session-1");
});

test("chat transcriptions route preserves a valid provided sessionId", async () => {
  const app = createChatTranscriptionsTestApp({
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => ({
      sessionId: sessionId ?? "session-fallback",
      runState: "idle",
      activeRunId: null,
      updatedAt: 1,
      activeRunHeartbeatAt: null,
      mainContentInvalidationVersion: 0,
      messages: [],
    }),
    transcribeAudioFn: async (_upload, requestContext) => {
      return requestContext.sessionId;
    },
  });

  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.webm", { type: "audio/webm" }));
  formData.append("source", "web");
  formData.append("sessionId", "session-provided");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "session-provided",
    sessionId: "session-provided",
  });
});

test("chat transcriptions route repairs stale sessionId values to the current session", async () => {
  let recoveryCalls = 0;
  const app = createChatTranscriptionsTestApp({
    getRecoveredChatSessionSnapshotFn: async (_userId, _workspaceId, sessionId) => {
      recoveryCalls += 1;
      if (sessionId === "session-stale") {
        throw new ChatSessionNotFoundError("session-stale");
      }

      return {
        sessionId: "session-current",
        runState: "idle",
        activeRunId: null,
        updatedAt: 1,
        activeRunHeartbeatAt: null,
        mainContentInvalidationVersion: 0,
        messages: [],
      };
    },
    transcribeAudioFn: async (_upload, requestContext) => {
      return `repaired:${requestContext.sessionId}`;
    },
  });

  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.webm", { type: "audio/webm" }));
  formData.append("source", "web");
  formData.append("sessionId", "session-stale");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "repaired:session-current",
    sessionId: "session-current",
  });
  assert.equal(recoveryCalls, 2);
});

test("chat transcriptions route blocks guest uploads immediately when guest AI quota defaults to zero", async () => {
  const originalGuestAiWeightedMonthlyTokenCap = process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;

  let transcribeCallCount = 0;
  const app = createChatTranscriptionsTestApp({
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
    transcribeAudioFn: async () => {
      transcribeCallCount += 1;
      return "ignored";
    },
  });

  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.webm", { type: "audio/webm" }));
  formData.append("source", "web");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  if (originalGuestAiWeightedMonthlyTokenCap === undefined) {
    delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  } else {
    process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = originalGuestAiWeightedMonthlyTokenCap;
  }

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "Your free monthly AI limit is used up on this device. Create an account to keep going.",
    code: "GUEST_AI_LIMIT_REACHED",
  });
  assert.equal(transcribeCallCount, 0);
});

test("chat transcriptions route rejects requests without a file upload", async () => {
  const app = createChatTranscriptionsTestApp({ transcribeAudioFn: async () => "ignored" });
  const formData = new FormData();
  formData.append("source", "ios");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "file is required",
    code: "CHAT_TRANSCRIPTION_FILE_REQUIRED",
  });
});

test("chat transcriptions route rejects unsupported media types", async () => {
  const app = createChatTranscriptionsTestApp({ transcribeAudioFn: async () => "ignored" });
  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.mp3", { type: "audio/mpeg" }));
  formData.append("source", "web");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Unsupported audio file type. Use m4a, wav, or webm.",
    code: "CHAT_TRANSCRIPTION_FILE_UNSUPPORTED",
  });
});

test("chat transcriptions route surfaces upstream failures as 503", async () => {
  const app = createChatTranscriptionsTestApp({
    transcribeAudioFn: async () => {
      throw new HttpError(503, "There is a network problem. Fix it and try again.", "CHAT_TRANSCRIPTION_UNAVAILABLE");
    },
  });
  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.wav", { type: "audio/wav" }));
  formData.append("source", "ios");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "There is a network problem. Fix it and try again.",
    code: "CHAT_TRANSCRIPTION_UNAVAILABLE",
  });
});

test("chat transcriptions route surfaces invalid audio failures as 422", async () => {
  const app = createChatTranscriptionsTestApp({
    transcribeAudioFn: async () => {
      throw new HttpError(422, "We couldn’t process that recording. Please try again.", "CHAT_TRANSCRIPTION_INVALID_AUDIO");
    },
  });
  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.webm", { type: "audio/webm" }));
  formData.append("source", "web");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "We couldn’t process that recording. Please try again.",
    code: "CHAT_TRANSCRIPTION_INVALID_AUDIO",
  });
});
