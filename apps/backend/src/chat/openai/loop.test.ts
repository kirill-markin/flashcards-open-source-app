import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import {
  CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS,
  startOpenAILoopWithDeps,
  type OpenAILoopEventSink,
  type StartOpenAILoopParams,
} from "./loop";

type OpenAILoopDependencies = Parameters<typeof startOpenAILoopWithDeps>[2];

function createParams(
  overrides: Partial<StartOpenAILoopParams> = {},
): StartOpenAILoopParams {
  return {
    requestId: "request-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
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

function createResponseStream(
  events: ReadonlyArray<OpenAI.Responses.ResponseStreamEvent>,
  finalResponse: OpenAI.Responses.Response,
): AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & Readonly<{
  finalResponse: () => Promise<OpenAI.Responses.Response>;
}> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      for (const event of events) {
        yield event;
      }
    },
    finalResponse: async (): Promise<OpenAI.Responses.Response> => finalResponse,
  };
}

function createDependencies(
  streamFactory: () => AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & Readonly<{
    finalResponse: () => Promise<OpenAI.Responses.Response>;
  }>,
  runOneToolCall: OpenAILoopDependencies["runOneToolCall"],
): OpenAILoopDependencies {
  return {
    buildChatCompletionInput: async () => [],
    getObservedOpenAIClient: () => ({
      responses: {
        stream: () => streamFactory(),
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

  const result = await startOpenAILoopWithDeps(
    createParams({
      onExecutionPhaseChanged: (phase): void => {
        phases.push(phase);
      },
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
