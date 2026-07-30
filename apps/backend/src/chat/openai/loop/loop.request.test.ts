import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { startOpenAILoopWithDeps } from "./loop";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
import { CHAT_MAX_OUTPUT_TOKENS } from "../../config";
import {
  buildChatCompletionInput,
  buildChatCompletionInputWithBudget,
} from "./input";
import {
  collectEvents,
  createAssistantMessageItem,
  createDependencies,
  createParams,
  createResponse,
  createResponseStream,
} from "./loop.testSupport";

function getSystemInstructions(
  request: OpenAI.Responses.ResponseCreateParams,
): string {
  if (Array.isArray(request.input) === false) {
    throw new Error("Expected the OpenAI request input to be an item array.");
  }
  const systemMessage = request.input[0];
  if (
    systemMessage?.type !== "message"
    || systemMessage.role !== "system"
    || typeof systemMessage.content !== "string"
  ) {
    throw new Error("Expected the first OpenAI request item to be a system message.");
  }
  return systemMessage.content;
}

test("startOpenAILoopWithDeps sends a hashed safety identifier on the initial model request", async () => {
  const requests: Array<OpenAI.Responses.ResponseCreateParams> = [];
  const messageItem = createAssistantMessageItem("done");

  await startOpenAILoopWithDeps(
    createParams({ generatedImageEligible: true }),
    async (): Promise<void> => undefined,
    {
      ...createDependencies(
        (request) => {
          requests.push(request);
          return createResponseStream([], createResponse([messageItem], "done"));
        },
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
      buildChatCompletionInput,
      buildChatCompletionInputWithBudget,
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].safety_identifier, buildOpenAISafetyIdentifier("user-1"));
  assert.equal(requests[0].prompt_cache_key, "session-1");
  assert.equal(requests[0].max_output_tokens, CHAT_MAX_OUTPUT_TOKENS);
  assert.deepEqual((requests[0]?.tools ?? []).flatMap(
    (tool) => tool.type === "function" ? [tool.name] : [],
  ), [
    "sql", "add_generated_image_to_card",
  ]);
  assert.equal(requests[0].parallel_tool_calls, false);
  assert.equal(Object.hasOwn(requests[0], "user"), false);
  assert.match(getSystemInstructions(requests[0]), /Generated-image policy:/u);
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
    {
      ...createDependencies(
        (request) => {
          requests.push(request);
          return createResponseStream([], createResponse([messageItem], "done"));
        },
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
      buildChatCompletionInput,
      buildChatCompletionInputWithBudget,
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.4-nano");
  assert.equal(requests[0].reasoning?.effort, "low");
  assert.deepEqual((requests[0]?.tools ?? []).flatMap(
    (tool) => tool.type === "function" ? [tool.name] : [],
  ), ["sql"]);
  assert.equal(Object.hasOwn(requests[0], "parallel_tool_calls"), false);
  assert.doesNotMatch(getSystemInstructions(requests[0]), /Generated-image policy:/u);
  assert.match(
    getSystemInstructions(requests[0]),
    /You are a flashcards assistant for an offline-first flashcards app\./u,
  );
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
