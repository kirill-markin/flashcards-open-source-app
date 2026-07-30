import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { startOpenAILoopWithDeps } from "./loop";
import {
  collectEvents,
  createAbortedResponseStream,
  createAbortedResponseStreamWithFinalResponse,
  createAssistantMessageItem,
  createContextLengthExceededStream,
  createDependencies,
  createFunctionCallAddedEvent,
  createFunctionCallItem,
  createParams,
  createPartialThenIncompleteStream,
  createPartialThenIncompleteWithFunctionCallStream,
  createResponse,
  createResponseErrorEvent,
  createResponseFailedEvent,
  createResponseIncompleteEvent,
  createResponseStream,
  createSdkAbortedResponseStream,
  createStreamWithoutCompletedResponse,
  createTerminalEventStream,
  type OpenAILoopDependencies,
} from "./loop.testSupport";

test("startOpenAILoopWithDeps rejects with AbortError when an aborted stream ends without a final response", async () => {
  const abortController = new AbortController();

  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams({
        signal: abortController.signal,
      }),
      async (): Promise<void> => undefined,
      createDependencies(
        () => createAbortedResponseStream(abortController),
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
    ),
    (error: unknown): boolean => {
      assert(error instanceof Error);
      assert.equal(error.name, "AbortError");
      assert.equal(error.message, "OpenAI response stream was aborted before a final response");
      return true;
    },
  );
});

test("startOpenAILoopWithDeps rejects with SDK abort errors when no stop is requested", async () => {
  const abortController = new AbortController();

  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams({
        signal: abortController.signal,
      }),
      async (): Promise<void> => undefined,
      createDependencies(
        () => createSdkAbortedResponseStream(abortController),
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
    ),
    (error: unknown): boolean => {
      assert(error instanceof OpenAI.APIUserAbortError);
      return true;
    },
  );
});

test("startOpenAILoopWithDeps uses finalResponse fallback before treating a late-aborted stream as aborted", async () => {
  const abortController = new AbortController();
  const messageItem = createAssistantMessageItem("partial");
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
    }),
    sink,
    createDependencies(
      () => createAbortedResponseStreamWithFinalResponse(
        abortController,
        createResponse([messageItem], "partial"),
      ),
      async () => {
        throw new Error("runOneToolCall should not be called");
      },
    ),
  );

  assert.equal(result.terminationReason, "completed");
  assert.deepEqual(events, [
    {
      type: "delta",
      text: "partial",
      itemId: "message-1",
      responseIndex: 0,
      outputIndex: 0,
      contentIndex: 0,
      sequenceNumber: 1,
    },
    { type: "done" },
  ]);
});

test("startOpenAILoopWithDeps fails with a classified terminal error on response.failed", async () => {
  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams({}),
      async (): Promise<void> => undefined,
      createDependencies(
        () => createTerminalEventStream(
          createResponseFailedEvent("server_error", "upstream model failure"),
        ),
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
    ),
    (error: unknown): boolean => {
      assert(error instanceof Error);
      assert.equal(error.name, "ChatProviderTerminalEventError");
      assert.equal((error as { code?: string }).code, "server_error");
      return true;
    },
  );
});

test("startOpenAILoopWithDeps finishes gracefully with partial text on a max_output_tokens incomplete response", async () => {
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams({}),
    sink,
    createDependencies(
      () => createPartialThenIncompleteStream("partial answer", "max_output_tokens"),
      async () => {
        throw new Error("runOneToolCall should not be called");
      },
    ),
  );

  assert.equal(result.terminationReason, "completed");
  assert.deepEqual(events, [
    {
      type: "delta",
      text: "partial answer",
      itemId: "message-1",
      responseIndex: 0,
      outputIndex: 0,
      contentIndex: 0,
      sequenceNumber: 1,
    },
    { type: "done" },
  ]);
});

test("startOpenAILoopWithDeps finishes with partial text and skips the tool call when a max_output_tokens response also carries a function call", async () => {
  let toolCallCount = 0;
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams({}),
    sink,
    createDependencies(
      () => createPartialThenIncompleteWithFunctionCallStream(
        "partial answer",
        createFunctionCallItem("completed"),
      ),
      async () => {
        toolCallCount += 1;
        return {
          output: "{\"ok\":true}",
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(toolCallCount, 0);
  assert.equal(result.terminationReason, "completed");
  assert.deepEqual(events.at(-1), { type: "done" });
  // The truncated function_call must not be persisted: replaying an orphan
  // function_call without a paired function_call_output makes the OpenAI
  // Responses API reject every later turn in the session.
  const unpairedFunctionCalls = result.openaiItems.filter(
    (item) => item.type === "function_call",
  );
  assert.equal(unpairedFunctionCalls.length, 0);
});

test("startOpenAILoopWithDeps fails with a classified terminal error on a content_filter incomplete response", async () => {
  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams({}),
      async (): Promise<void> => undefined,
      createDependencies(
        () => createTerminalEventStream(
          createResponseIncompleteEvent("content_filter"),
        ),
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
    ),
    (error: unknown): boolean => {
      assert(error instanceof Error);
      assert.equal(error.name, "ChatProviderTerminalEventError");
      assert.equal((error as { code?: string }).code, "content_filter");
      return true;
    },
  );
});

test("startOpenAILoopWithDeps fails with a classified terminal error on an error event", async () => {
  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams({}),
      async (): Promise<void> => undefined,
      createDependencies(
        () => createTerminalEventStream(
          createResponseErrorEvent("rate_limit_exceeded", "provider error event"),
        ),
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
    ),
    (error: unknown): boolean => {
      assert(error instanceof Error);
      assert.equal(error.name, "ChatProviderTerminalEventError");
      assert.equal((error as { code?: string }).code, "rate_limit_exceeded");
      return true;
    },
  );
});

test("startOpenAILoopWithDeps fails with a classified terminal error when the stream ends without a completed response", async () => {
  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams({}),
      async (): Promise<void> => undefined,
      createDependencies(
        () => createStreamWithoutCompletedResponse(),
        async () => {
          throw new Error("runOneToolCall should not be called");
        },
      ),
    ),
    (error: unknown): boolean => {
      assert(error instanceof Error);
      assert.equal(error.name, "ChatProviderTerminalEventError");
      assert.equal((error as { code?: string }).code, "stream_closed_without_response");
      return true;
    },
  );
});

test("startOpenAILoopWithDeps retries a callIndex > 1 overflow once with the reduced history budget then succeeds", async () => {
  let streamCallCount = 0;
  let toolCallCount = 0;
  let reducedBudgetRebuilds = 0;
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");
  const messageItem = createAssistantMessageItem("recovered");
  const { sink, events } = collectEvents();

  const dependencies: OpenAILoopDependencies = {
    buildChatCompletionInput: async () => [],
    buildChatCompletionInputWithBudget: async () => {
      reducedBudgetRebuilds += 1;
      return [];
    },
    getObservedOpenAIClient: () => ({
      responses: {
        stream: () => {
          streamCallCount += 1;
          if (streamCallCount === 1) {
            return createResponseStream(
              [createFunctionCallAddedEvent(startedFunctionCallItem)],
              createResponse([completedFunctionCallItem], ""),
            );
          }

          if (streamCallCount === 2) {
            return createContextLengthExceededStream();
          }

          return createResponseStream([], createResponse([messageItem], "recovered"));
        },
      },
    } as unknown as OpenAI),
    runOneToolCall: async () => {
      toolCallCount += 1;
      return {
        output: "{\"ok\":true}",
        isMutating: false,
        succeeded: true,
        shouldInvalidateMainContent: false,
        stopReason: null,
        generatedImageTelemetry: null,
      };
    },
  };

  const result = await startOpenAILoopWithDeps(createParams({}), sink, dependencies);

  assert.equal(streamCallCount, 3);
  assert.equal(toolCallCount, 1);
  assert.equal(reducedBudgetRebuilds, 1);
  assert.equal(result.terminationReason, "completed");
  assert.deepEqual(events.at(-1), { type: "done" });
  assert.deepEqual(result.openaiItems, [
    {
      type: "function_call",
      call_id: "call-1",
      name: "sql",
      arguments: "{\"sql\":\"select 1\"}",
      status: "completed",
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: "{\"ok\":true}",
    },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{
        type: "output_text",
        text: "recovered",
        annotations: [],
      }],
    },
  ]);
});
