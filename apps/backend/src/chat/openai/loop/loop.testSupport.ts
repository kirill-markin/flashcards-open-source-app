import OpenAI from "openai";
import {
  startOpenAILoopWithDeps,
  type OpenAILoopEventSink,
  type StartOpenAILoopParams,
} from "./loop";

export type OpenAILoopDependencies = Parameters<typeof startOpenAILoopWithDeps>[2];
export type OpenAIResponseStream = AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & Readonly<{
  finalResponse?: () => Promise<OpenAI.Responses.Response>;
}>;

export function createParams(
  overrides: Partial<StartOpenAILoopParams>,
): StartOpenAILoopParams {
  return {
    requestId: "request-1",
    claimToken: "2026-07-24 10:11:12.123456+00",
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

export function createFunctionCallItem(
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

export function createIndexedFunctionCallItem(
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

export function createAssistantMessageItem(
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

export function createResponse(
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

export function createFunctionCallAddedEvent(
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

export function createResponseFailedEvent(
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

export function createResponseIncompleteEvent(
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

export function createResponseErrorEvent(
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

export function createContextLengthExceededStream(): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      throw createContextLengthExceededError();
    },
  };
}

export function createTerminalEventStream(
  event: OpenAI.Responses.ResponseStreamEvent,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield event;
    },
  };
}

export function createStreamWithoutCompletedResponse(): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent("partial");
    },
  };
}

export function createPartialThenIncompleteStream(
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

export function createPartialThenIncompleteWithFunctionCallStream(
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

export function createResponseStream(
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

export function createAbortedResponseStream(
  abortController: AbortController,
): OpenAIResponseStream {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield createOutputTextDeltaEvent("partial");
      abortController.abort();
    },
  };
}

export function createAbortedResponseStreamWithFinalResponse(
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

export function createSdkAbortedResponseStream(
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

export function createDependencies(
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

export function collectEvents(): Readonly<{
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
