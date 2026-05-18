import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/aws-serverless";
import { HttpError } from "../../errors";
import { transcribeChatAudioUploadWithDependencies } from "../transcriptions";

type MutableSentryModule = typeof Sentry & {
  addBreadcrumb: (
    breadcrumb: Parameters<typeof Sentry.addBreadcrumb>[0],
  ) => ReturnType<typeof Sentry.addBreadcrumb>;
  captureMessage: (
    message: Parameters<typeof Sentry.captureMessage>[0],
    captureContext: Parameters<typeof Sentry.captureMessage>[1],
  ) => ReturnType<typeof Sentry.captureMessage>;
};

type ConsoleMethod = "log" | "warn";

type ProviderError = Error & Readonly<{
  status: number;
  requestID: string;
}>;

const sentryModule = require("@sentry/aws-serverless") as MutableSentryModule;

function createProviderError(message: string, status: number, requestID: string): ProviderError {
  return Object.assign(new Error(message), {
    status,
    requestID,
  });
}

function withOpenAIKey<Result>(fn: () => Promise<Result>): Promise<Result> {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";

  return fn().finally(() => {
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
      return;
    }

    process.env.OPENAI_API_KEY = originalOpenAIKey;
  });
}

function withCapturedConsole<Result>(
  method: ConsoleMethod,
  fn: () => Promise<Result>,
): Promise<Readonly<{
  messages: ReadonlyArray<string>;
  result: Result;
}>> {
  const originalMethod = console[method];
  const messages: Array<string> = [];
  console[method] = (message?: unknown): void => {
    messages.push(typeof message === "string" ? message : String(message));
  };

  return fn().then(
    (result) => ({ messages, result }),
    (error: unknown) => {
      throw error;
    },
  ).finally(() => {
    console[method] = originalMethod;
  });
}

function createFailingTranscriptionClient(error: Error): Parameters<typeof transcribeChatAudioUploadWithDependencies>[2] {
  return {
    audio: {
      transcriptions: {
        create: async () => {
          throw error;
        },
      },
    },
  };
}

async function assertTranscriptionHttpError(
  error: Error,
  statusCode: number,
  code: string,
): Promise<void> {
  const upload = {
    file: new File(["audio"], "private-user-recording.m4a", { type: "audio/m4a" }),
    source: "web" as const,
  };

  await assert.rejects(
    () => transcribeChatAudioUploadWithDependencies(
      upload,
      {
        requestId: "request-1",
        sessionId: "session-1",
      },
      createFailingTranscriptionClient(error),
      {
        getObservedOpenAIClient: () => {
          throw new Error("Expected explicit transcription client.");
        },
      },
    ),
    (caughtError: unknown): boolean => {
      assert.equal(caughtError instanceof HttpError, true);
      if (caughtError instanceof HttpError === false) {
        return false;
      }

      assert.equal(caughtError.statusCode, statusCode);
      assert.equal(caughtError.code, code);
      return true;
    },
  );
}

test("invalid chat transcription audio failures create a breadcrumb without a Sentry warning issue", async () => {
  const originalAddBreadcrumb = sentryModule.addBreadcrumb;
  const originalCaptureMessage = sentryModule.captureMessage;
  let breadcrumbCount = 0;
  let captureMessageCount = 0;
  sentryModule.addBreadcrumb = () => {
    breadcrumbCount += 1;
  };
  sentryModule.captureMessage = () => {
    captureMessageCount += 1;
    return "event-id";
  };

  try {
    const { messages } = await withCapturedConsole("log", async () => {
      await withOpenAIKey(async () => {
        await assertTranscriptionHttpError(
          createProviderError("Audio processing failed for user@example.com", 422, "upstream-request-1"),
          422,
          "CHAT_TRANSCRIPTION_INVALID_AUDIO",
        );
      });
    });

    assert.equal(captureMessageCount, 0);
    assert.equal(breadcrumbCount, 1);
    assert.equal(messages.length, 1);
    assert.deepEqual(JSON.parse(messages[0] ?? ""), {
      domain: "backend",
      action: "chat_transcription_invalid_audio",
      service: "backend-api",
      requestId: "request-1",
      route: null,
      method: null,
      userId: null,
      workspaceId: null,
      chatRequestId: null,
      runId: null,
      sessionId: "session-1",
      source: "web",
      provider: "openai",
      fileSize: 5,
      fileExtension: "m4a",
      mediaType: "audio/m4a",
      upstreamStatus: 422,
      upstreamRequestId: "upstream-request-1",
      errorClass: "Error",
      errorMessage: "Audio processing failed for <masked-email>",
    });
  } finally {
    sentryModule.addBreadcrumb = originalAddBreadcrumb;
    sentryModule.captureMessage = originalCaptureMessage;
  }
});

test("unexpected chat transcription failures keep safe warning details", async () => {
  const originalCaptureMessage = sentryModule.captureMessage;
  let captureMessageCount = 0;
  sentryModule.captureMessage = () => {
    captureMessageCount += 1;
    return "event-id";
  };

  try {
    const { messages } = await withCapturedConsole("warn", async () => {
      await withOpenAIKey(async () => {
        await assertTranscriptionHttpError(
          createProviderError("Provider failed with user@example.com", 502, "upstream-request-2"),
          503,
          "CHAT_TRANSCRIPTION_UNAVAILABLE",
        );
      });
    });

    assert.equal(captureMessageCount, 1);
    assert.equal(messages.length, 1);
    const record = JSON.parse(messages[0] ?? "");
    assert.equal(record.action, "chat_transcription_failed");
    assert.equal(record.fileExtension, "m4a");
    assert.equal(record.upstreamRequestId, "upstream-request-2");
    assert.equal(record.errorMessage, "Provider failed with <masked-email>");
    assert.equal("fileName" in record, false);
    assert.equal("upstreamMessage" in record, false);
    assert.equal("sanitizedMessage" in record, false);
  } finally {
    sentryModule.captureMessage = originalCaptureMessage;
  }
});
