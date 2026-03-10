import assert from "node:assert/strict";
import test from "node:test";
import { createLocalChatErrorEvent, parseLocalChatDiagnosticsBody, streamLocalChatResponse } from "./chat/http";
import { HttpError } from "./errors";
import {
  buildLocalSystemInstructions,
  LocalChatRuntimeError,
  isSupportedLocalChatModel,
  streamLocalAgentTurn,
} from "./chat/openai/localAgent";
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

type FakeAttempt = Readonly<{
  events: ReadonlyArray<FakeStreamEvent>;
  finalResponse: FakeFinalResponse;
}>;

type CapturedStreamBody = Readonly<{
  model: string;
  instructions: string;
  input: ReadonlyArray<unknown>;
  tools: ReadonlyArray<unknown>;
  parallel_tool_calls: boolean;
}>;

function makeFakeClient(
  attempts: ReadonlyArray<FakeAttempt>,
  capturedBodies: Array<CapturedStreamBody>,
): Readonly<{
  responses: Readonly<{
    stream: (body: Readonly<Record<string, unknown>>) => AsyncIterable<FakeStreamEvent> & Readonly<{
      finalResponse: () => Promise<FakeFinalResponse>;
    }>;
  }>;
}> {
  let attemptIndex = 0;

  return {
    responses: {
      stream(body: Readonly<Record<string, unknown>>) {
        capturedBodies.push(body as CapturedStreamBody);
        const attempt = attempts[attemptIndex];
        attemptIndex += 1;

        if (attempt === undefined) {
          throw new Error("Unexpected extra stream attempt");
        }

        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<FakeStreamEvent> {
            for (const event of attempt.events) {
              yield event;
            }
          },
          async finalResponse(): Promise<FakeFinalResponse> {
            return attempt.finalResponse;
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

test("buildLocalSystemInstructions includes strict tool-call rules and examples", () => {
  const instructions = buildLocalSystemInstructions("Europe/Madrid");

  assert.match(instructions, /Tool arguments must be exactly one JSON object\./);
  assert.match(instructions, /If a field is optional semantically, send null instead of omitting it\./);
  assert.match(instructions, /wait for explicit user confirmation before executing the write tool/i);
  assert.match(instructions, /list_cards => \{"limit": 20\}/);
  assert.match(instructions, /search_cards => \{"query": "grammar", "limit": null\}/);
  assert.match(instructions, /list_review_history => \{"limit": 20, "cardId": null\}/);
  assert.match(instructions, /update_card => \{"cardId": "card_123"/);
  assert.match(instructions, /update_deck => \{"deckId": "deck_123"/);
});

test("streamLocalAgentTurn emits text deltas and done when no tool calls are requested", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [{
      events: [
        { type: "response.output_text.delta", delta: "Hello" },
        { type: "response.output_text.delta", delta: " world" },
      ],
      finalResponse: {
        output: [
          { type: "message" },
        ],
      },
    }],
    capturedBodies,
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.2",
    timezone: "Europe/Madrid",
    requestId: "request-1",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Hello" },
    { type: "delta", text: " world" },
    { type: "done" },
  ]);
  assert.equal(capturedBodies[0]?.model, "gpt-5.2");
  assert.equal(capturedBodies[0]?.parallel_tool_calls, false);
});

test("streamLocalAgentTurn retries malformed tool arguments and emits repair_attempt", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [
      {
        events: [{ type: "response.output_text.delta", delta: "Checking cards." }],
        finalResponse: {
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "list_cards",
              arguments: "{\"limit\":5}\n{\"limit\":10}",
            },
          ],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [
            {
              type: "function_call",
              call_id: "call-2",
              name: "list_cards",
              arguments: "{\"limit\":10}",
            },
          ],
        },
      },
    ],
    capturedBodies,
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{ role: "user", content: "list my cards" }],
    model: "gpt-4.1-mini",
    timezone: "Europe/Madrid",
    requestId: "request-2",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Checking cards." },
    {
      type: "repair_attempt",
      message: "Assistant is correcting list_cards.",
      attempt: 1,
      maxAttempts: 3,
      toolName: "list_cards",
    },
    { type: "tool_call_request", toolCallId: "call-2", name: "list_cards", input: "{\"limit\":10}" },
    { type: "await_tool_results" },
  ]);

  assert.equal(capturedBodies.length, 2);
  assert.equal(capturedBodies[1]?.model, "gpt-4.1-mini");
  assert.equal(capturedBodies[1]?.parallel_tool_calls, false);
  assert.ok(
    capturedBodies[1]?.instructions.includes("Tool arguments must be exactly one JSON object."),
  );
});

test("streamLocalAgentTurn retries schema failures before emitting a tool call", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [
      {
        events: [],
        finalResponse: {
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "list_cards",
              arguments: "{}",
            },
          ],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [
            {
              type: "function_call",
              call_id: "call-2",
              name: "list_cards",
              arguments: "{\"limit\":null}",
            },
          ],
        },
      },
    ],
    capturedBodies,
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{ role: "user", content: "list my cards" }],
    model: "gpt-5.4",
    timezone: "Europe/Madrid",
    requestId: "request-3",
  }, client));

  assert.deepEqual(events, [
    {
      type: "repair_attempt",
      message: "Assistant is correcting list_cards.",
      attempt: 1,
      maxAttempts: 3,
      toolName: "list_cards",
    },
    { type: "tool_call_request", toolCallId: "call-2", name: "list_cards", input: "{\"limit\":null}" },
    { type: "await_tool_results" },
  ]);
});

test("streamLocalAgentTurn stops after three repair attempts", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-1", name: "list_cards", arguments: "{}" }],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-2", name: "list_cards", arguments: "{}" }],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-3", name: "list_cards", arguments: "{}" }],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-4", name: "list_cards", arguments: "{}" }],
        },
      },
    ],
    capturedBodies,
  );

  await assert.rejects(
    async () => {
      await collectEvents(streamLocalAgentTurn({
        messages: [{ role: "user", content: "list my cards" }],
        model: "gpt-5.4",
        timezone: "Europe/Madrid",
        requestId: "request-4",
      }, client));
    },
    (error: unknown) => error instanceof LocalChatRuntimeError && error.code === "LOCAL_TOOL_CALL_INVALID" && error.stage === "tool_call_validation",
  );

  assert.equal(capturedBodies.length, 4);
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

test("createLocalChatErrorEvent includes machine-readable diagnostics fields", () => {
  assert.deepEqual(
    createLocalChatErrorEvent("boom", "request-123", "LOCAL_CHAT_STREAM_FAILED", "stream_local_turn"),
    {
      type: "error",
      message: "boom",
      code: "LOCAL_CHAT_STREAM_FAILED",
      stage: "stream_local_turn",
      requestId: "request-123",
    },
  );
});

test("parseLocalChatDiagnosticsBody accepts the local iOS diagnostics payload", () => {
  const body = parseLocalChatDiagnosticsBody({
    clientRequestId: "client-1",
    backendRequestId: "backend-1",
    stage: "decoding_event_json",
    errorKind: "invalid_sse_event_json",
    statusCode: null,
    eventType: "tool_call_request",
    toolName: "list_cards",
    toolCallId: "call-1",
    lineNumber: 12,
    rawSnippet: "{\"type\":\"tool_call_request\"}",
    decoderSummary: "Unexpected character '{'",
    selectedModel: "gpt-5.4",
    messageCount: 2,
    appVersion: "0.1.0",
    devicePlatform: "ios",
  });

  assert.equal(body.clientRequestId, "client-1");
  assert.equal(body.backendRequestId, "backend-1");
  assert.equal(body.errorKind, "invalid_sse_event_json");
});
