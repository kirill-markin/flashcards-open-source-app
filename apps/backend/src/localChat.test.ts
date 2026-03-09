import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import { streamLocalChatResponse } from "./app";
import { isSupportedLocalChatModel, streamLocalAgentTurn } from "./chat/openai/localAgent";
import type { LocalChatStreamEvent } from "./chat/localTypes";

type FakeStreamEvent = Readonly<{
  type: "response.output_text.delta";
  delta: string;
}>;

type FakeOutputItem = Readonly<{
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}>;

type FakeFinalResponse = Readonly<{
  output: ReadonlyArray<FakeOutputItem>;
}>;

function makeFakeClient(
  events: ReadonlyArray<FakeStreamEvent>,
  finalResponse: FakeFinalResponse,
): Readonly<{
  responses: Readonly<{
    stream: () => AsyncIterable<FakeStreamEvent> & Readonly<{ finalResponse: () => Promise<FakeFinalResponse> }>;
  }>;
}> {
  return {
    responses: {
      stream() {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<FakeStreamEvent> {
            for (const event of events) {
              yield event;
            }
          },
          async finalResponse(): Promise<FakeFinalResponse> {
            return finalResponse;
          },
        };
      },
    },
  };
}

async function collectEvents(iterable: AsyncIterable<LocalChatStreamEvent>): Promise<Array<LocalChatStreamEvent>> {
  const events: Array<LocalChatStreamEvent> = [];

  for await (const event of iterable) {
    events.push(event);
  }

  return events;
}

test("isSupportedLocalChatModel accepts only OpenAI local-chat models", () => {
  assert.equal(isSupportedLocalChatModel("gpt-5.4"), true);
  assert.equal(isSupportedLocalChatModel("claude-sonnet-4-6"), false);
});

test("streamLocalAgentTurn emits text deltas and done when no tool calls are requested", async () => {
  const client = makeFakeClient(
    [
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: " world" },
    ],
    {
      output: [
        { type: "message" },
      ],
    },
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    timezone: "Europe/Madrid",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Hello" },
    { type: "delta", text: " world" },
    { type: "done" },
  ]);
});

test("streamLocalAgentTurn emits tool requests and await_tool_results when a function call is returned", async () => {
  const client = makeFakeClient(
    [{ type: "response.output_text.delta", delta: "I will inspect local cards." }],
    {
      output: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "list_cards",
          arguments: "{\"limit\":5}",
        },
      ],
    },
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{ role: "user", content: "list my cards" }],
    model: "gpt-5.4",
    timezone: "Europe/Madrid",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "I will inspect local cards." },
    { type: "tool_call_request", toolCallId: "call-1", name: "list_cards", input: "{\"limit\":5}" },
    { type: "await_tool_results" },
  ]);
});

test("streamLocalChatResponse rejects unknown local model", async () => {
  await assert.rejects(
    async () => {
      await streamLocalChatResponse(
        {
          messages: [{ role: "user", content: "hi" }],
          model: "claude-sonnet-4-6",
          timezone: "Europe/Madrid",
        },
        "request-id",
      );
    },
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});
