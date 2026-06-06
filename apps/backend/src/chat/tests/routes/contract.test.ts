import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "../../../shared/errors";
import { createChatRoutes } from "../../../routes/chat";
import type { AppEnv } from "../../../server/app";
import type { RequestContext } from "../../../server/requestContext";
import {
  chatMaximumStartRunRequestBytes,
  chatRequestTooLargeCode,
  chatRequestTooLargeMessage,
  parseChatRequestBody,
} from "../../http/contract";
import {
  chatAttachmentUnsupportedTypeCode,
  chatAttachmentUnsupportedTypeMessage,
} from "../../attachmentPolicy";
import type { ChatSessionSnapshot, PersistedChatMessageItem } from "../../store";

const SESSION_ONE = "11111111-1111-4111-8111-111111111111";
const PLAIN_TEXT_BASE64 = "cGxhaW4gdGV4dA==";
const VALID_PDF_BASE64 = "JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAxIDFdID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1Jvb3QgMSAwIFIgL1NpemUgNCA+PgpzdGFydHhyZWYKMTgyCiUlRU9GCg==";
const TRUNCATED_PDF_BASE64 = "JVBERi0xLjcK";
const VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const TRUNCATED_PNG_BASE64 = "iVBORw0KGgo=";
const WINDOWS_1252_CSV_BASE64 = "ZnJvbnQsYmFjawpjYWbpLGNvZmZlZQo=";
const UTF16_LE_CSV_BASE64 = "//5mAHIAbwBuAHQALABiAGEAYwBrAAoAYwBhAGYA6QAsAGMAbwBmAGYAZQBlAAoA";
const BINARY_TEXT_FILE_BASE64 = "AAECAwQFBgc=";

type ConsoleMethod = "log" | "warn" | "error";
type StructuredLogRecord = Readonly<Record<string, unknown> & {
  consoleMethod: ConsoleMethod;
}>;

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
    guestSessionId: null,
    guestPlatform: null,
  };
}

function createRoutesWithHttpErrorJson() {
  const app = new Hono<AppEnv>();
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
  return app;
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

function createRunningSnapshot(): ChatSessionSnapshot {
  return {
    sessionId: SESSION_ONE,
    runState: "running",
    activeRunId: "run-1",
    updatedAt: 1,
    activeRunHeartbeatAt: 1,
    composerSuggestions: [],
    mainContentInvalidationVersion: 0,
    messages: [],
  };
}

function createAssistantItem(
  state: PersistedChatMessageItem["state"],
): PersistedChatMessageItem {
  return {
    itemId: "assistant-1",
    sessionId: SESSION_ONE,
    itemOrder: 6,
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    state,
    isError: false,
    isStopped: false,
    timestamp: 1,
    updatedAt: 1,
  };
}

async function withCapturedLogs(
  execute: () => Promise<void>,
): Promise<ReadonlyArray<StructuredLogRecord>> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const records: Array<StructuredLogRecord> = [];

  const captureMessage = (message: unknown, consoleMethod: ConsoleMethod): void => {
    if (typeof message === "string") {
      records.push({
        ...(JSON.parse(message) as Record<string, unknown>),
        consoleMethod,
      });
    }
  };

  console.log = (...args: unknown[]): void => {
    captureMessage(args[0], "log");
  };
  console.warn = (...args: unknown[]): void => {
    captureMessage(args[0], "warn");
  };
  console.error = (...args: unknown[]): void => {
    captureMessage(args[0], "error");
  };

  try {
    await execute();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  return records;
}

function findLog(
  records: ReadonlyArray<StructuredLogRecord>,
  action: string,
): StructuredLogRecord | undefined {
  return records.find((record) => record.action === action);
}

test("parseChatRequestBody normalizes supported attachment media type aliases", () => {
  const cases = [
    {
      fileName: "deck.csv",
      mediaType: "text/comma-separated-values",
      expectedMediaType: "text/csv",
    },
    {
      fileName: "deck.csv",
      mediaType: "",
      expectedMediaType: "text/csv",
    },
    {
      fileName: "deck.csv",
      mediaType: "text/csv; charset=utf-8",
      expectedMediaType: "text/csv",
    },
    {
      fileName: "script.ts",
      mediaType: "text/x-typescript",
      expectedMediaType: "application/typescript",
    },
    {
      fileName: "cards.xml",
      mediaType: "application/xml",
      expectedMediaType: "text/xml",
    },
  ] as const;

  for (const testCase of cases) {
    const body = parseChatRequestBody({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: [{
        type: "file",
        fileName: testCase.fileName,
        mediaType: testCase.mediaType,
        base64Data: "YQ==",
      }],
      timezone: "Europe/Madrid",
    });

    const part = body.content[0];
    assert.ok(part !== undefined);
    if (part.type !== "file") {
      throw new Error("Expected a file content part.");
    }
    assert.equal(part.mediaType, testCase.expectedMediaType);
  }
});

test("parseChatRequestBody accepts valid attachment payload signatures", () => {
  const cases = [
    {
      content: [{
        type: "file",
        fileName: "deck.csv",
        mediaType: "text/comma-separated-values",
        base64Data: "ZnJvbnQsYmFjaw==",
      }],
      expectedMediaType: "text/csv",
    },
    {
      content: [{
        type: "file",
        fileName: "cards.xml",
        mediaType: "application/xml",
        base64Data: "PGNhcmRzIC8+",
      }],
      expectedMediaType: "text/xml",
    },
    {
      content: [{
        type: "file",
        fileName: "deck.csv",
        mediaType: "text/csv",
        base64Data: WINDOWS_1252_CSV_BASE64,
      }],
      expectedMediaType: "text/csv",
    },
    {
      content: [{
        type: "file",
        fileName: "deck.csv",
        mediaType: "text/csv",
        base64Data: UTF16_LE_CSV_BASE64,
      }],
      expectedMediaType: "text/csv",
    },
    {
      content: [{
        type: "file",
        fileName: "notes.pdf",
        mediaType: "application/pdf",
        base64Data: VALID_PDF_BASE64,
      }],
      expectedMediaType: "application/pdf",
    },
    {
      content: [{
        type: "image",
        mediaType: "image/png",
        base64Data: VALID_PNG_BASE64,
      }],
      expectedMediaType: "image/png",
    },
  ] as const;

  for (const testCase of cases) {
    const body = parseChatRequestBody({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: testCase.content,
      timezone: "Europe/Madrid",
    });

    const part = body.content[0];
    assert.ok(part !== undefined);
    if (part.type !== "file" && part.type !== "image") {
      throw new Error("Expected an attachment content part.");
    }
    assert.equal(part.mediaType, testCase.expectedMediaType);
  }
});

test("parseChatRequestBody rejects unsupported attachment file extensions with a stable code", () => {
  assert.throws(
    () => parseChatRequestBody({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: [{
        type: "file",
        fileName: "notes.rtf",
        mediaType: "text/plain",
        base64Data: "YQ==",
      }],
      timezone: "Europe/Madrid",
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.code === chatAttachmentUnsupportedTypeCode
      && error.message === chatAttachmentUnsupportedTypeMessage,
  );
});

test("GET /chat fails with a stable contract code when running snapshot has no in-progress assistant item", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("completed")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`, {
    headers: {
      "X-Chat-Resume-Attempt-Id": "resume-1",
      "X-Client-Platform": "web",
      "X-Client-Version": "web-test",
    },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Chat live resume contract violation",
    requestId: null,
    code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
  });
});

test("GET /chat resume contract warnings include the Hono request id", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("completed")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
  });
  const app = createRoutesWithHttpErrorJson();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-route-1");
    await next();
  });
  app.route("/", routes);

  const logs = await withCapturedLogs(async () => {
    const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`);
    assert.equal(response.status, 500);
  });

  const warningLog = findLog(logs, "chat_resume_contract_violation");
  assert.equal(warningLog?.consoleMethod, "warn");
  assert.equal(warningLog?.requestId, "request-route-1");
});

test("GET /chat fails with a stable contract code when a running snapshot cannot create a live stream", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    resolveLiveCursorFn: async () => "5",
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("in_progress")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => null as never,
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request(`http://localhost/chat?sessionId=${SESSION_ONE}`);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Chat live resume contract violation",
    requestId: null,
    code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
  });
});

test("POST /chat captures unexpected live envelope failures before returning the stable contract code", async () => {
  let interruptCount = 0;
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => ({
      sessionId: SESSION_ONE,
      runId: "run-1",
      clientRequestId: "client-request-1",
      runState: "running",
      deduplicated: false,
      shouldInvokeWorker: false,
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    resolveLiveCursorFn: async () => "5",
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("in_progress")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => {
      throw new Error("live signer exploded");
    },
    interruptPreparedChatRunFn: async () => {
      interruptCount += 1;
    },
  });
  const app = createRoutesWithHttpErrorJson();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-route-2");
    await next();
  });
  app.route("/", routes);

  const logs = await withCapturedLogs(async () => {
    const response = await app.request("http://localhost/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: SESSION_ONE,
        clientRequestId: "client-request-1",
        content: [{ type: "text", text: "hello" }],
        timezone: "Europe/Madrid",
      }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Chat live resume contract violation",
      requestId: null,
      code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
    });
  });

  const exceptionLog = findLog(logs, "request_failed");
  assert.equal(interruptCount, 1);
  assert.equal(exceptionLog?.consoleMethod, "error");
  assert.equal(exceptionLog?.requestId, "request-route-2");
  assert.equal(exceptionLog?.runId, "run-1");
  assert.equal(exceptionLog?.errorMessage, "live signer exploded");
});

test("POST /chat returns a structured request-too-large error above the app soft limit", async () => {
  let prepareChatRunCount = 0;
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => {
      prepareChatRunCount += 1;
      throw new Error("prepareChatRunFn should not be called");
    },
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: [
        {
          type: "image",
          mediaType: "image/png",
          base64Data: "a".repeat(chatMaximumStartRunRequestBytes),
        },
      ],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 413);
  assert.equal(prepareChatRunCount, 0);
  assert.deepEqual(await response.json(), {
    error: chatRequestTooLargeMessage,
    requestId: null,
    code: chatRequestTooLargeCode,
  });
});

test("POST /chat rejects unsupported attachments before preparing a run", async () => {
  let prepareChatRunCount = 0;
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => {
      prepareChatRunCount += 1;
      throw new Error("prepareChatRunFn should not be called");
    },
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: [
        {
          type: "file",
          fileName: "notes.rtf",
          mediaType: "text/plain",
          base64Data: "YQ==",
        },
      ],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(prepareChatRunCount, 0);
  assert.deepEqual(await response.json(), {
    error: chatAttachmentUnsupportedTypeMessage,
    requestId: null,
    code: chatAttachmentUnsupportedTypeCode,
  });
});

test("POST /chat rejects invalid attachment payloads before preparing a run", async () => {
  let prepareChatRunCount = 0;
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => {
      prepareChatRunCount += 1;
      throw new Error("prepareChatRunFn should not be called");
    },
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);
  const cases = [
    {
      content: [{
        type: "file",
        fileName: "notes.txt",
        mediaType: "text/plain",
        base64Data: "not-base64!",
      }],
    },
    {
      content: [{
        type: "image",
        mediaType: "image/png",
        base64Data: `data:image/png;base64,${VALID_PNG_BASE64}`,
      }],
    },
    {
      content: [{
        type: "file",
        fileName: "notes.pdf",
        mediaType: "application/pdf",
        base64Data: PLAIN_TEXT_BASE64,
      }],
    },
    {
      content: [{
        type: "file",
        fileName: "notes.pdf",
        mediaType: "application/pdf",
        base64Data: TRUNCATED_PDF_BASE64,
      }],
    },
    {
      content: [{
        type: "image",
        mediaType: "image/png",
        base64Data: TRUNCATED_PNG_BASE64,
      }],
    },
    {
      content: [{
        type: "file",
        fileName: "notes.txt",
        mediaType: "text/plain",
        base64Data: BINARY_TEXT_FILE_BASE64,
      }],
    },
  ] as const;

  for (const testCase of cases) {
    const response = await app.request("http://localhost/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: SESSION_ONE,
        clientRequestId: "client-request-1",
        content: testCase.content,
        timezone: "Europe/Madrid",
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: chatAttachmentUnsupportedTypeMessage,
      requestId: null,
      code: chatAttachmentUnsupportedTypeCode,
    });
  }

  assert.equal(prepareChatRunCount, 0);
});

test("POST /chat fails with a stable contract code when a running response cannot create a live stream", async () => {
  const routes = createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    prepareChatRunFn: async () => ({
      sessionId: SESSION_ONE,
      runId: "run-1",
      clientRequestId: "client-request-1",
      runState: "running",
      deduplicated: false,
      shouldInvokeWorker: false,
    }),
    getRecoveredChatSessionSnapshotFn: async () => createRunningSnapshot(),
    resolveLiveCursorFn: async () => "5",
    listChatMessagesLatestFn: async () => ({
      messages: [createAssistantItem("in_progress")],
      oldestCursor: "6",
      newestCursor: "6",
      hasOlder: false,
    }),
    createChatLiveStreamEnvelopeFn: async () => null as never,
    interruptPreparedChatRunFn: async () => undefined,
  });
  const app = createRoutesWithHttpErrorJson();
  app.route("/", routes);

  const response = await app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: SESSION_ONE,
      clientRequestId: "client-request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    }),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Chat live resume contract violation",
    requestId: null,
    code: "CHAT_LIVE_RESUME_CONTRACT_VIOLATION",
  });
});
