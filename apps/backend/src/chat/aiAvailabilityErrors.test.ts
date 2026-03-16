import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAIEndpointFailure,
  makeAIEndpointNotConfiguredError,
} from "./aiAvailabilityErrors";

test("makeAIEndpointNotConfiguredError returns the stable local chat contract", () => {
  const error = makeAIEndpointNotConfiguredError("chat");
  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "LOCAL_CHAT_NOT_CONFIGURED");
  assert.equal(error.message, "AI chat is not configured on this server.");
});

test("classifyAIEndpointFailure maps provider auth failures to a stable chat code", () => {
  const error = classifyAIEndpointFailure(
    "chat",
    { status: 401, message: "Invalid API key" },
    "openai",
  );

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "LOCAL_CHAT_PROVIDER_AUTH_FAILED");
  assert.equal(error.message, "AI chat is temporarily unavailable on this server. Try again later.");
});

test("classifyAIEndpointFailure maps provider quota failures to a stable transcription code", () => {
  const error = classifyAIEndpointFailure(
    "transcription",
    { status: 429, message: "insufficient credits" },
    "openai",
  );

  assert.equal(error.statusCode, 429);
  assert.equal(error.code, "CHAT_TRANSCRIPTION_RATE_LIMITED");
  assert.equal(error.message, "AI audio transcription is temporarily unavailable on this server. Try again later.");
});

test("classifyAIEndpointFailure maps unknown provider failures to unavailable", () => {
  const error = classifyAIEndpointFailure(
    "chat",
    new Error("socket hang up"),
    "anthropic",
  );

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "LOCAL_CHAT_UNAVAILABLE");
  assert.equal(error.message, "AI chat is temporarily unavailable on this server. Try again later.");
});

test("classifyAIEndpointFailure maps chat continuation failures to a stable chat code", () => {
  const error = classifyAIEndpointFailure(
    "chat",
    { status: 400, message: "No tool output found for function call call_123." },
    "openai",
  );

  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "LOCAL_CHAT_CONTINUATION_FAILED");
  assert.equal(error.message, "AI chat is temporarily unavailable on this server. Try again later.");
});
