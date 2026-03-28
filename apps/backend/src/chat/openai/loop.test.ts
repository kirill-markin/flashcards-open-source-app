import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { startOpenAILoopWithDeps } from "./loop";

test("startOpenAILoopWithDeps streams deltas and returns replay items", async () => {
  const finalResponse: OpenAI.Responses.Response = {
    id: "resp_1",
    object: "response",
    created_at: 0,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: "gpt-5.4",
    output: [{
      id: "msg_1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{
        type: "output_text",
        text: "Hello",
        annotations: [],
      }],
    }],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 1,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 1,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: 2,
    },
    user: undefined,
    metadata: {},
    output_text: "Hello",
    reasoning: {
      effort: "medium",
      summary: null,
    },
  };

  const stream = {
    async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      yield {
        type: "response.output_text.delta",
        delta: "Hello",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        sequence_number: 1,
      } as OpenAI.Responses.ResponseTextDeltaEvent;
      yield {
        type: "response.completed",
        response: finalResponse,
      } as OpenAI.Responses.ResponseCompletedEvent;
    },
    finalResponse: async (): Promise<OpenAI.Responses.Response> => finalResponse,
  };

  const started = await startOpenAILoopWithDeps(
    {
      requestId: "req-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      timezone: "UTC",
      localMessages: [],
      turnInput: [{ type: "text", text: "hi" }],
      rootObservation: null,
    },
    {
      buildChatCompletionInput: async () => [],
      getObservedOpenAIClient: () => ({
        responses: {
          stream: () => stream,
        },
      } as unknown as OpenAI),
      runOneToolCall: async () => {
        throw new Error("Tool execution should not be called");
      },
    },
  );

  const events: Array<unknown> = [];
  for await (const event of started.events) {
    events.push(event);
  }

  const completion = await started.completion;
  assert.deepEqual(events, [
    {
      type: "delta",
      text: "Hello",
      itemId: "msg_1",
      responseIndex: 0,
      outputIndex: 0,
      contentIndex: 0,
      sequenceNumber: 1,
    },
    { type: "done" },
  ]);
  assert.equal(completion.openaiItems.length, 1);
});
