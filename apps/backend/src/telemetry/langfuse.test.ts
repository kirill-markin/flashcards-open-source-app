import assert from "node:assert/strict";
import test from "node:test";
import { propagateAttributes, startObservation } from "@langfuse/tracing";
import {
  getLangfuseConfigValidationErrors,
  initializeLangfuseTelemetryWithDeps,
  resetLangfuseTelemetryForTests,
  sanitizeTelemetryValue,
  startChatTranscriptionObservationWithDeps,
  startChatTurnObservationWithDeps,
} from "./langfuse";

const originalLangfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
const originalLangfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
const originalLangfuseBaseUrl = process.env.LANGFUSE_BASE_URL;

function restoreEnvironment(): void {
  if (originalLangfusePublicKey === undefined) {
    delete process.env.LANGFUSE_PUBLIC_KEY;
  } else {
    process.env.LANGFUSE_PUBLIC_KEY = originalLangfusePublicKey;
  }

  if (originalLangfuseSecretKey === undefined) {
    delete process.env.LANGFUSE_SECRET_KEY;
  } else {
    process.env.LANGFUSE_SECRET_KEY = originalLangfuseSecretKey;
  }

  if (originalLangfuseBaseUrl === undefined) {
    delete process.env.LANGFUSE_BASE_URL;
  } else {
    process.env.LANGFUSE_BASE_URL = originalLangfuseBaseUrl;
  }

  resetLangfuseTelemetryForTests();
}

test.afterEach(restoreEnvironment);

test("getLangfuseConfigValidationErrors rejects partial Langfuse config", () => {
  const errors = getLangfuseConfigValidationErrors({
    LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    LANGFUSE_SECRET_KEY: "",
    LANGFUSE_BASE_URL: "",
  });

  assert.deepEqual(errors, [
    "LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL must be configured together",
  ]);
});

test("sanitizeTelemetryValue masks sensitive strings and redacts base64Data", () => {
  const sanitized = sanitizeTelemetryValue({
    email: "user@example.com",
    phone: "+34 600 123 456",
    apiKey: "sk_test_12345678901234567890",
    card: "1234567890123456",
    attachment: {
      base64Data: "Zm9vYmFy",
      fileName: "statement.pdf",
    },
  });

  assert.deepEqual(sanitized, {
    email: "<masked-email>",
    phone: "+<masked-phone>",
    apiKey: "<masked-api-key>",
    card: "<masked-phone>",
    attachment: {
      base64Data: "<redacted-base64>",
      fileName: "statement.pdf",
    },
  });
});

test("initializeLangfuseTelemetryWithDeps rejects partial config at startup", () => {
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_BASE_URL;

  assert.throws(
    () => initializeLangfuseTelemetryWithDeps({
      createLangfuseSpanProcessor: () => null,
      createNodeSdk: () => {
        throw new Error("should not create sdk");
      },
      startNodeSdk: () => undefined,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL must be configured together"),
  );
});

test("startChatTurnObservationWithDeps falls back to a null observation when tracing startup fails", async () => {
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  process.env.LANGFUSE_BASE_URL = "https://cloud.langfuse.com";

  const observedRoots: Array<unknown> = [];

  await assert.doesNotReject(async () => startChatTurnObservationWithDeps(
    {
      requestId: "req-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      model: "gpt-5.4",
      turnIndex: 1,
      runState: "running",
      turnInput: [{ type: "text", text: "hello@example.com" }],
    },
    async (rootObservation): Promise<void> => {
      observedRoots.push(rootObservation);
    },
    {
      createTraceId: async () => {
        throw new Error("trace init failed");
      },
      propagateAttributes,
      startObservation,
    },
  ));

  assert.deepEqual(observedRoots, [null]);
});

test("startChatTranscriptionObservationWithDeps attaches safe transcription metadata including sessionId", async () => {
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  process.env.LANGFUSE_BASE_URL = "https://cloud.langfuse.com";

  const startedObservations: Array<{
    name: string;
    input: unknown;
    metadata: unknown;
  }> = [];

  const result = await startChatTranscriptionObservationWithDeps(
    {
      requestId: "req-1",
      userId: "user-1",
      sessionId: "session-1",
      source: "web",
      fileName: "clip.webm",
      mediaType: "audio/webm",
      fileSize: 128,
    },
    async (): Promise<string> => "recognized text",
    {
      createTraceId: async () => "1234567890abcdef1234567890abcdef",
      propagateAttributes,
      startObservation: ((name, params) => {
        startedObservations.push({
          name,
          input: params?.input,
          metadata: params?.metadata,
        });
        return {
          updateOtelSpanAttributes: () => undefined,
          end: () => undefined,
        } as unknown;
      }) as typeof startObservation,
    },
  );

  assert.equal(result, "recognized text");
  assert.equal(startedObservations.length, 1);
  assert.deepEqual(startedObservations[0], {
    name: "chat_transcription",
    input: {
      sessionId: "session-1",
      source: "web",
      fileName: "clip.webm",
      mediaType: "audio/webm",
      fileSize: 128,
    },
    metadata: {
      requestId: "req-1",
      userId: "user-1",
      sessionId: "session-1",
      source: "web",
      fileName: "clip.webm",
      mediaType: "audio/webm",
      fileSize: "128",
    },
  });
});
