import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import {
  CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS,
  startOpenAILoopWithDeps,
  type OpenAILoopEventSink,
  type StartOpenAILoopParams,
} from "./loop";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
import { CHAT_MAX_OUTPUT_TOKENS } from "../../config";

type OpenAILoopDependencies = Parameters<typeof startOpenAILoopWithDeps>[2];
type OpenAIResponseStream = AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & Readonly<{
  finalResponse?: () => Promise<OpenAI.Responses.Response>;
}>;

function createParams(
  overrides: Partial<StartOpenAILoopParams> = {},
): StartOpenAILoopParams {
  return {
    requestId: "request-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    modelId: "gpt-5.4",
    reasoningEffort: "medium",
    timezone: "Europe/Madrid",
    localMessages: [],
    turnInput: [{ type: "text", text: "hello" }],
    rootObservation: null,
    ...overrides,
  };
}

function createFunctionCallItem(
  status: "in_progress" | "completed",
): OpenAI.Responses.ResponseFunctionToolCall {
  return {
    type: "function_call",
    id: "tool-item-1",
    call_id: "call-1",
    name: "sql",
    arguments: "{\"sql\":\"select 1\"}",
    status,
  } as OpenAI.Responses.ResponseFunctionToolCall;
}

function createIndexedFunctionCallItem(
  index: number,
  status: "in_progress" | "completed",
): OpenAI.Responses.ResponseFunctionToolCall {
  return {
    type: "function_call",
    id: `tool-item-${String(index)}`,
    call_id: `call-${String(index)}`,
    name: "sql",
    arguments: `{"sql":"select ${String(index)}"}`,
    status,
  } as OpenAI.Responses.ResponseFunctionToolCall;
}

function createAssistantMessageItem(
  text: string,
): OpenAI.Responses.ResponseOutputMessage {
  return {
    type: "message",
    id: "message-1",
    role: "assistant",
    status: "completed",
    content: [{
      type: "output_text",
      text,
      annotations: [],
    }],
  } as OpenAI.Responses.ResponseOutputMessage;
}

function createResponse(
  output: ReadonlyArray<OpenAI.Responses.ResponseOutputItem>,
  outputText: string,
): OpenAI.Responses.Response {
  return {
    id: "response-1",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: "gpt-5.4",
    output: [...output],
    output_text: outputText,
    parallel_tool_calls: false,
    temperature: 1,
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    background: false,
    conversation: null,
    metadata: null,
    previous_response_id: null,
    prompt_cache_key: null,
    prompt_cache_retention: null,
    reasoning: {
      effort: null,
      summary: null,
    },
    safety_identifier: null,
    service_tier: null,
    store: false,
    text: {
      format: {
        type: "text",
      },
    },
    truncation: "disabled",
    usage: null,
    user: null,
  } as unknown as OpenAI.Responses.Response;
}

function createFunctionCallAddedEvent(
  item: OpenAI.Responses.ResponseFunctionToolCall,
): OpenAI.Responses.ResponseOutputItemAddedEvent {
  return {
    type: "response.output_item.added",
    item,
    output_index: 0,
    sequence_number: 1,
  } as OpenAI.Responses.ResponseOutputItemAddedEvent;
}

function createOutputTextDeltaEvent(text: string): OpenAI.Responses.ResponseTextDeltaEvent {
  return {
    type: "response.output_text.delta",
    delta: text,
    item_id: "message-1",
    output_index: 0,
    content_index: 0,
    sequence_number: 1,
  } as OpenAI.Responses.ResponseTextDeltaEvent;
}

function createResponseFailedEvent(
  code: OpenAI.Responses.ResponseError["code"],
  message: string,
): OpenAI.Responses.ResponseFailedEvent {
  return {
    type: "response.failed",
    sequence_number: 1,
    response: {
      ...createResponse([], ""),
      status: "failed",
      error: { code, message },
    },
  } as OpenAI.Responses.ResponseFailedEvent;
}

function createResponseIncompleteEvent(
  reason: "max_output_tokens" | "content_filter",
): OpenAI.Responses.ResponseIncompleteEvent {
  return {
    type: "response.incomplete",
    sequence_number: 1,
    response: {
      ...createResponse([], ""),
      status: "incomplete",
      incomplete_details: { reason },
    },
  } as OpenAI.Responses.ResponseIncompleteEvent;
}

function createResponseErrorEvent(
  code: string | null,
  message: string,
): OpenAI.Responses.ResponseErrorEvent {
  return {
    type: "error",
    code,
    message,
    param: null,
    sequence_number: 1,
  };
}

function createContextLengthExceededError(): Error {
  return Object.assign(new Error("input exceeds the context window"), {
    code: "context_length_exceeded",
  });
}

function createContextLengthExceededStream(): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      throw createContextLengthExceededError();
    },
  };
}

function createTerminalEventStream(
  event: OpenAI.Responses.ResponseStreamEvent,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield event;
    },
  };
}

function createStreamWithoutCompletedResponse(): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent("partial");
    },
  };
}

function createPartialThenIncompleteStream(
  text: string,
  reason: "max_output_tokens" | "content_filter",
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent(text);
      yield createResponseIncompleteEvent(reason);
    },
  };
}

function createMaxOutputTokensIncompleteEventWithFunctionCall(
  outputText: string,
  functionCallItem: OpenAI.Responses.ResponseFunctionToolCall,
): OpenAI.Responses.ResponseIncompleteEvent {
  return {
    type: "response.incomplete",
    sequence_number: 1,
    response: {
      ...createResponse([functionCallItem], outputText),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    },
  } as OpenAI.Responses.ResponseIncompleteEvent;
}

function createPartialThenIncompleteWithFunctionCallStream(
  text: string,
  functionCallItem: OpenAI.Responses.ResponseFunctionToolCall,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent(text);
      yield createMaxOutputTokensIncompleteEventWithFunctionCall(text, functionCallItem);
    },
  };
}

function createResponseStream(
  events: ReadonlyArray<OpenAI.Responses.ResponseStreamEvent>,
  finalResponse: OpenAI.Responses.Response,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      for (const event of events) {
        yield event;
      }
    },
    finalResponse: async (): Promise<OpenAI.Responses.Response> => finalResponse,
  };
}

function createAbortedResponseStream(
  abortController: AbortController,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent("partial");
      abortController.abort();
    },
  };
}

function createAbortedResponseStreamWithFinalResponse(
  abortController: AbortController,
  finalResponse: OpenAI.Responses.Response,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent("partial");
      abortController.abort();
    },
    finalResponse: async (): Promise<OpenAI.Responses.Response> => finalResponse,
  };
}

function createSdkAbortedResponseStream(
  abortController: AbortController,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent("partial");
      abortController.abort();
    },
    finalResponse: async (): Promise<OpenAI.Responses.Response> => {
      throw new OpenAI.APIUserAbortError();
    },
  };
}

function createDependencies(
  streamFactory: (request: OpenAI.Responses.ResponseCreateParams) => OpenAIResponseStream,
  runOneToolCall: OpenAILoopDependencies["runOneToolCall"],
): OpenAILoopDependencies {
  return {
    buildChatCompletionInput: async () => [],
    buildChatCompletionInputWithBudget: async () => [],
    getObservedOpenAIClient: () => ({
      responses: {
        stream: (request: OpenAI.Responses.ResponseCreateParams) => streamFactory(request),
      },
    } as unknown as OpenAI),
    runOneToolCall,
  };
}

function collectEvents(): Readonly<{
  sink: OpenAILoopEventSink;
  events: Array<unknown>;
}> {
  const events: Array<unknown> = [];

  return {
    sink: async (event): Promise<void> => {
      events.push(event);
    },
    events,
  };
}

test("startOpenAILoopWithDeps sends a hashed safety identifier on the initial model request", async () => {
  const requests: Array<OpenAI.Responses.ResponseCreateParams> = [];
  const messageItem = createAssistantMessageItem("done");

  await startOpenAILoopWithDeps(
    createParams(),
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

test("startOpenAILoopWithDeps stops before the next tool call when requested", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  const result = await startOpenAILoopWithDeps(
    createParams({
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        stopBeforeNextStep = true;
        return createResponseStream(
          [createFunctionCallAddedEvent(startedFunctionCallItem)],
          createResponse([completedFunctionCallItem], ""),
        );
      },
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

  assert.equal(streamCallCount, 1);
  assert.equal(toolCallCount, 0);
  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.deepEqual(result.openaiItems, [{
    type: "function_call",
    call_id: "call-1",
    name: "sql",
    arguments: "{\"sql\":\"select 1\"}",
    status: "completed",
  }]);
});

test("startOpenAILoopWithDeps stops after a completed tool call before the next model call", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams({
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    sink,
    createDependencies(
      () => {
        streamCallCount += 1;
        return createResponseStream(
          [createFunctionCallAddedEvent(startedFunctionCallItem)],
          createResponse([completedFunctionCallItem], ""),
        );
      },
      async () => {
        toolCallCount += 1;
        stopBeforeNextStep = true;
        return {
          output: "{\"ok\":true}",
          isMutating: true,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(streamCallCount, 1);
  assert.equal(toolCallCount, 1);
  assert.equal(result.terminationReason, "stopped_before_next_step");
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
  ]);
  assert.deepEqual(events, [
    {
      type: "tool_call",
      id: "call-1",
      itemId: "tool-item-1",
      name: "sql",
      status: "started",
      responseIndex: 0,
      outputIndex: 0,
      sequenceNumber: 1,
      providerStatus: "in_progress",
      input: "{\"sql\":\"select 1\"}",
    },
    {
      type: "tool_call",
      id: "call-1",
      itemId: "tool-item-1",
      name: "sql",
      status: "completed",
      responseIndex: 0,
      outputIndex: 0,
      sequenceNumber: 1,
      providerStatus: "completed",
      input: "{\"sql\":\"select 1\"}",
      output: "{\"ok\":true}",
      refreshRoute: true,
    },
  ]);
});

test("startOpenAILoopWithDeps preserves replay items when a deadline aborts before a next model final response", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const abortController = new AbortController();
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        if (streamCallCount === 1) {
          return createResponseStream(
            [createFunctionCallAddedEvent(startedFunctionCallItem)],
            createResponse([completedFunctionCallItem], ""),
          );
        }

        stopBeforeNextStep = true;
        return createAbortedResponseStream(abortController);
      },
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

  assert.equal(streamCallCount, 2);
  assert.equal(toolCallCount, 1);
  assert.equal(result.terminationReason, "stopped_before_next_step");
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
  ]);
});

test("startOpenAILoopWithDeps preserves replay items when a deadline aborts a next SDK model final response", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const abortController = new AbortController();
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        if (streamCallCount === 1) {
          return createResponseStream(
            [createFunctionCallAddedEvent(startedFunctionCallItem)],
            createResponse([completedFunctionCallItem], ""),
          );
        }

        stopBeforeNextStep = true;
        return createSdkAbortedResponseStream(abortController);
      },
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

  assert.equal(streamCallCount, 2);
  assert.equal(toolCallCount, 1);
  assert.equal(result.terminationReason, "stopped_before_next_step");
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
  ]);
});

test("startOpenAILoopWithDeps reports phase transitions for model and tool execution", async () => {
  let stopBeforeNextStep = false;
  const phases: Array<string> = [];
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  await startOpenAILoopWithDeps(
    createParams({
      onExecutionPhaseChanged: (phase): void => {
        phases.push(phase);
      },
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => createResponseStream(
        [createFunctionCallAddedEvent(startedFunctionCallItem)],
        createResponse([completedFunctionCallItem], ""),
      ),
      async () => {
        stopBeforeNextStep = true;
        return {
          output: "{\"ok\":true}",
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.deepEqual(phases, ["idle", "model", "idle", "tool", "idle", "idle"]);
});

test("startOpenAILoopWithDeps reports model phase transitions for the tool-limit summary call", async () => {
  let streamCallCount = 0;
  let toolCallCount = 0;
  const phases: Array<string> = [];
  const requests: Array<OpenAI.Responses.ResponseCreateParams> = [];

  const result = await startOpenAILoopWithDeps(
    createParams({
      onExecutionPhaseChanged: (phase): void => {
        phases.push(phase);
      },
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      (request) => {
        requests.push(request);
        streamCallCount += 1;
        if (streamCallCount <= CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS) {
          return createResponseStream(
            [createFunctionCallAddedEvent(createIndexedFunctionCallItem(streamCallCount, "in_progress"))],
            createResponse([createIndexedFunctionCallItem(streamCallCount, "completed")], ""),
          );
        }

        return createResponseStream(
          [],
          createResponse([createAssistantMessageItem("summary")], "summary"),
        );
      },
      async () => {
        toolCallCount += 1;
        return {
          output: `{"call":${String(toolCallCount)}}`,
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(result.terminationReason, "completed");
  assert.equal(streamCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1);
  assert.equal(toolCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS);
  assert.deepEqual(
    requests.map((request) => request.safety_identifier),
    Array.from(
      { length: CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1 },
      () => buildOpenAISafetyIdentifier("user-1"),
    ),
  );
  assert.equal(requests[1].safety_identifier, buildOpenAISafetyIdentifier("user-1"));
  assert.equal(requests[CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS].tools?.length, 0);
  assert.equal(
    phases.filter((phase) => phase === "model").length,
    CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1,
  );
  assert.equal(
    phases.filter((phase) => phase === "tool").length,
    CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS,
  );
  assert.deepEqual(phases.slice(-3), ["model", "idle", "idle"]);
});

test("startOpenAILoopWithDeps preserves replay items when a deadline aborts the tool-limit summary call", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const abortController = new AbortController();

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        if (streamCallCount <= CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS) {
          return createResponseStream(
            [createFunctionCallAddedEvent(createIndexedFunctionCallItem(streamCallCount, "in_progress"))],
            createResponse([createIndexedFunctionCallItem(streamCallCount, "completed")], ""),
          );
        }

        stopBeforeNextStep = true;
        return createSdkAbortedResponseStream(abortController);
      },
      async () => {
        toolCallCount += 1;
        return {
          output: `{"call":${String(toolCallCount)}}`,
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.equal(streamCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1);
  assert.equal(toolCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS);
  assert.equal(result.openaiItems.length, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS * 2);
  assert.deepEqual(result.openaiItems[0], {
    type: "function_call",
    call_id: "call-1",
    name: "sql",
    arguments: "{\"sql\":\"select 1\"}",
    status: "completed",
  });
  assert.deepEqual(result.openaiItems[result.openaiItems.length - 1], {
    type: "function_call_output",
    call_id: `call-${String(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)}`,
    output: `{"call":${String(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)}}`,
  });
});

test("startOpenAILoopWithDeps fails with a classified terminal error on response.failed", async () => {
  await assert.rejects(
    startOpenAILoopWithDeps(
      createParams(),
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
    createParams(),
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
    createParams(),
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
      createParams(),
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
      createParams(),
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
      createParams(),
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

test("startOpenAILoopWithDeps completes normally when no stop is requested", async () => {
  let streamCallCount = 0;
  const messageItem = createAssistantMessageItem("done");
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams(),
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
      };
    },
  };

  const result = await startOpenAILoopWithDeps(createParams(), sink, dependencies);

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
