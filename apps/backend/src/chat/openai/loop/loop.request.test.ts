import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { startOpenAILoopWithDeps } from "./loop";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
import { CHAT_MAX_OUTPUT_TOKENS } from "../../config";
import {
  collectEvents,
  createAssistantMessageItem,
  createDependencies,
  createParams,
  createResponse,
  createResponseStream,
} from "./loop.testSupport";

test("startOpenAILoopWithDeps sends a hashed safety identifier on the initial model request", async () => {
  const requests: Array<OpenAI.Responses.ResponseCreateParams> = [];
  const messageItem = createAssistantMessageItem("done");

  await startOpenAILoopWithDeps(
    createParams({}),
    async (): Promise<void> => undefined,
    createDependencies(
      (request) => {
        requests.push(request);
        return createResponseStream([], createResponse([messageItem], "done"));
      },
      async () => {
        throw new Error("runOneToolCall should not be called");
      },
    ),
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].safety_identifier, buildOpenAISafetyIdentifier("user-1"));
  assert.equal(requests[0].prompt_cache_key, "session-1");
  assert.equal(requests[0].max_output_tokens, CHAT_MAX_OUTPUT_TOKENS);
  assert.equal(Object.hasOwn(requests[0], "user"), false);
});

test("startOpenAILoopWithDeps uses the persisted runtime model and reasoning effort", async () => {
  const requests: Array<OpenAI.Responses.ResponseCreateParams> = [];
  const messageItem = createAssistantMessageItem("done");

  await startOpenAILoopWithDeps(
    createParams({
      modelId: "gpt-5.4-nano",
      reasoningEffort: "low",
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      (request) => {
        requests.push(request);
        return createResponseStream([], createResponse([messageItem], "done"));
      },
      async () => {
        throw new Error("runOneToolCall should not be called");
      },
    ),
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.4-nano");
  assert.equal(requests[0].reasoning?.effort, "low");
});

test("startOpenAILoopWithDeps completes normally when no stop is requested", async () => {
  let streamCallCount = 0;
  const messageItem = createAssistantMessageItem("done");
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams({}),
    sink,
    createDependencies(
      () => {
        streamCallCount += 1;
        return createResponseStream([], createResponse([messageItem], "done"));
      },
      async () => {
        throw new Error("runOneToolCall should not be called");
      },
    ),
  );

  assert.equal(streamCallCount, 1);
  assert.equal(result.terminationReason, "completed");
  assert.deepEqual(events, [{ type: "done" }]);
});
