import assert from "node:assert/strict";
import test from "node:test";
import { APIConnectionError, APIError } from "openai/error";
import { HttpError } from "../errors";
import { transcribeChatAudioUpload } from "./transcriptions";

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

function restoreEnvironment(): void {
  if (originalOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
    return;
  }

  process.env.OPENAI_API_KEY = originalOpenAiApiKey;
}

test.afterEach(restoreEnvironment);

test("transcribeChatAudioUpload returns a stable not-configured error when the provider key is missing", async () => {
  delete process.env.OPENAI_API_KEY;

  await assert.rejects(
    () => transcribeChatAudioUpload({
      file: new File(["audio"], "clip.webm", { type: "audio/webm" }),
      source: "web",
      durationSeconds: 1,
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 503
      && error.code === "CHAT_TRANSCRIPTION_NOT_CONFIGURED"
      && error.message === "AI audio transcription is not configured on this server.",
  );
});

test("transcribeChatAudioUpload maps invalid upstream audio failures to 422", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const client = {
    audio: {
      transcriptions: {
        create: async () => {
          throw APIError.generate(
            400,
            { error: { message: "Audio file might be corrupted or unsupported." } },
            undefined,
            new Headers({ "x-request-id": "openai-request-1" }),
          );
        },
      },
    },
  };

  await assert.rejects(
    () => transcribeChatAudioUpload({
      file: new File(["audio"], "clip.webm", { type: "audio/webm" }),
      source: "web",
      durationSeconds: 1,
    }, client),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 422
      && error.code === "CHAT_TRANSCRIPTION_INVALID_AUDIO"
      && error.message === "We couldn’t process that recording. Please try again.",
  );
});

test("transcribeChatAudioUpload keeps provider connectivity failures as 503", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const client = {
    audio: {
      transcriptions: {
        create: async () => {
          throw new APIConnectionError({ message: "socket hang up" });
        },
      },
    },
  };

  await assert.rejects(
    () => transcribeChatAudioUpload({
      file: new File(["audio"], "clip.m4a", { type: "audio/mp4" }),
      source: "ios",
      durationSeconds: 1,
    }, client),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 503
      && error.code === "CHAT_TRANSCRIPTION_UNAVAILABLE"
      && error.message === "AI audio transcription is temporarily unavailable on this server. Try again later.",
  );
});

test("transcribeChatAudioUpload maps provider auth failures to a stable 503 error", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const client = {
    audio: {
      transcriptions: {
        create: async () => {
          throw APIError.generate(
            401,
            { error: { message: "Invalid API key" } },
            undefined,
            new Headers({ "x-request-id": "openai-request-auth" }),
          );
        },
      },
    },
  };

  await assert.rejects(
    () => transcribeChatAudioUpload({
      file: new File(["audio"], "clip.m4a", { type: "audio/mp4" }),
      source: "ios",
      durationSeconds: 1,
    }, client),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 503
      && error.code === "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED"
      && error.message === "AI audio transcription is temporarily unavailable on this server. Try again later.",
  );
});

test("transcribeChatAudioUpload maps provider rate limits to a stable 429 error", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const client = {
    audio: {
      transcriptions: {
        create: async () => {
          throw APIError.generate(
            429,
            { error: { message: "insufficient credits" } },
            undefined,
            new Headers({ "x-request-id": "openai-request-rate-limit" }),
          );
        },
      },
    },
  };

  await assert.rejects(
    () => transcribeChatAudioUpload({
      file: new File(["audio"], "clip.m4a", { type: "audio/mp4" }),
      source: "ios",
      durationSeconds: 1,
    }, client),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 429
      && error.code === "CHAT_TRANSCRIPTION_RATE_LIMITED"
      && error.message === "AI audio transcription is temporarily unavailable on this server. Try again later.",
  );
});
