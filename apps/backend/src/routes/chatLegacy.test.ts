import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { HttpError } from "../errors";
import type { RequestContext } from "../server/requestContext";
import { createChatLegacyRoutes } from "./chatLegacy";

function createChatLegacyTestApp(
  options: Readonly<{
    requestContext?: RequestContext;
    streamAIChatResponseFn?: Parameters<typeof createChatLegacyRoutes>[0]["streamAIChatResponseFn"];
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
  app.route("/", createChatLegacyRoutes({
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
    streamAIChatResponseFn: options.streamAIChatResponseFn,
  }));
  return app;
}

test("legacy chat turn route forwards the authenticated request context to the AI chat response pipeline", async () => {
  let observedUserId: string | null = null;
  let observedTransport: string | null = null;
  let observedDevicePlatform: string | null = null;
  const app = createChatLegacyTestApp({
    requestContext: {
      userId: "user-42",
      subjectUserId: "user-42",
      selectedWorkspaceId: "workspace-1",
      email: "user@example.com",
      locale: "en",
      userSettingsCreatedAt: "2026-03-12T10:00:00.000Z",
      transport: "bearer",
      connectionId: null,
    },
    streamAIChatResponseFn: async (body: unknown, _requestId: string, requestContext: RequestContext) => {
      observedUserId = requestContext.userId;
      observedTransport = requestContext.transport;
      observedDevicePlatform = (body as { devicePlatform: string }).devicePlatform;
      return new Response(null, { status: 204 });
    },
  });

  const response = await app.request("https://api.example.com/chat/turn", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      model: "gpt-5.4",
      timezone: "Europe/Madrid",
      devicePlatform: "web",
      chatSessionId: "chat-session-test-1",
      codeInterpreterContainerId: null,
      userContext: { totalCards: 5 },
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(observedUserId, "user-42");
  assert.equal(observedTransport, "bearer");
  assert.equal(observedDevicePlatform, "web");
});

test("legacy chat turn route forwards android device platform without remapping it to ios", async () => {
  let observedDevicePlatform: string | null = null;
  const app = createChatLegacyTestApp({
    streamAIChatResponseFn: async (body: unknown) => {
      observedDevicePlatform = (body as { devicePlatform: string }).devicePlatform;
      return new Response(null, { status: 204 });
    },
  });

  const response = await app.request("https://api.example.com/chat/turn", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      model: "gpt-5.4",
      timezone: "Europe/Madrid",
      devicePlatform: "android",
      chatSessionId: "chat-session-test-android-1",
      codeInterpreterContainerId: null,
      userContext: { totalCards: 5 },
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(observedDevicePlatform, "android");
});
