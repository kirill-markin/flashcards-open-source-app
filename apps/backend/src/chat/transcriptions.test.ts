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
    }, client),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 503
      && error.code === "CHAT_TRANSCRIPTION_UNAVAILABLE"
      && error.message === "There is a network problem. Fix it and try again.",
  );
});
