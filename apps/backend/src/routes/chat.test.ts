import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { HttpError } from "../errors";
import { createChatRoutes } from "./chat";

function createChatTestApp(
  transcribeAudioFn: Parameters<typeof createChatRoutes>[0]["transcribeAudioFn"],
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
        userId: "user-1",
        selectedWorkspaceId: "workspace-1",
        email: "user@example.com",
        locale: "en",
        userSettingsCreatedAt: "2026-03-12T10:00:00.000Z",
        transport: "bearer",
        connectionId: null,
      },
    }),
    transcribeAudioFn,
  }));
  return app;
}

test("chat transcriptions route accepts multipart uploads and returns text", async () => {
  let observedSource: string | null = null;
  let observedFileName: string | null = null;
  const app = createChatTestApp(async (upload) => {
    observedSource = upload.source;
    observedFileName = upload.file.name;
    return "recognized text";
  });

  const formData = new FormData();
  formData.append("file", new File(["audio"], "clip.webm", { type: "audio/webm" }));
  formData.append("source", "web");

  const response = await app.request("https://api.example.com/chat/transcriptions", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "recognized text" });
  assert.equal(observedSource, "web");
  assert.equal(observedFileName, "clip.webm");
});

test("chat transcriptions route rejects requests without a file upload", async () => {
  const app = createChatTestApp(async () => "ignored");
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
  const app = createChatTestApp(async () => "ignored");
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
  const app = createChatTestApp(async () => {
    throw new HttpError(503, "There is a network problem. Fix it and try again.", "CHAT_TRANSCRIPTION_UNAVAILABLE");
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
