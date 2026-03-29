import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyChatTranscriptionFailure,
  makeChatTranscriptionNotConfiguredError,
} from "./providerFailure";

test("makeChatTranscriptionNotConfiguredError returns the stable transcription contract", () => {
  const error = makeChatTranscriptionNotConfiguredError();

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "CHAT_TRANSCRIPTION_NOT_CONFIGURED");
  assert.equal(error.message, "AI audio transcription is not configured on this server.");
});

test("classifyChatTranscriptionFailure maps provider auth failures to a stable code", () => {
  const error = classifyChatTranscriptionFailure({ status: 401, message: "Invalid API key" });

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED");
  assert.equal(error.message, "AI audio transcription is temporarily unavailable on this server. Try again later.");
  assert.equal(error.provider, "openai");
});

test("classifyChatTranscriptionFailure maps provider quota failures to a stable code", () => {
  const error = classifyChatTranscriptionFailure({ status: 429, message: "insufficient credits" });

  assert.equal(error.statusCode, 429);
  assert.equal(error.code, "CHAT_TRANSCRIPTION_RATE_LIMITED");
  assert.equal(error.message, "AI audio transcription is temporarily unavailable on this server. Try again later.");
  assert.equal(error.provider, "openai");
});

test("classifyChatTranscriptionFailure maps unknown provider failures to unavailable", () => {
  const error = classifyChatTranscriptionFailure(new Error("socket hang up"));

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "CHAT_TRANSCRIPTION_UNAVAILABLE");
  assert.equal(error.message, "AI audio transcription is temporarily unavailable on this server. Try again later.");
  assert.equal(error.provider, "openai");
});
