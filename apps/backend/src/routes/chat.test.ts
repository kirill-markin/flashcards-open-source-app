import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { HttpError } from "../errors";
import type { RequestContext } from "../server/requestContext";
import {
  createChatRoutes,
  parseChatRequestBody,
  parseStopChatRequestBody,
} from "./chat";

function createChatTestApp(
  options: Readonly<{
    enabled?: boolean;
    requestContext?: RequestContext;
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

test("new chat routes accept the server-owned request shape and answer not ready", async () => {
  const app = createChatTestApp({ enabled: true });

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

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "Backend-owned AI chat is not implemented yet.",
    code: "AI_CHAT_V2_NOT_READY",
  });
});

test("new chat stop route validates the new stop contract before returning not ready", async () => {
  const app = createChatTestApp({ enabled: true });

  const response = await app.request("https://api.example.com/chat/stop", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "session-1",
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "Backend-owned AI chat is not implemented yet.",
    code: "AI_CHAT_V2_NOT_READY",
  });
});
