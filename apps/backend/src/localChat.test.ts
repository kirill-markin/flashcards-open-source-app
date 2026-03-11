import assert from "node:assert/strict";
import test from "node:test";
import { createLocalChatErrorEvent, parseLocalChatDiagnosticsBody, streamLocalChatResponse } from "./chat/http";
import { buildLocalSystemInstructions } from "./chat/localRuntimeShared";
import { HttpError } from "./errors";
import {
  LocalChatRuntimeError,
  isSupportedLocalChatModel,
  streamLocalAgentTurn,
} from "./chat/openai/localAgent";
import {
  LocalChatRuntimeError as AnthropicLocalChatRuntimeError,
  isSupportedLocalChatModel as isSupportedAnthropicLocalChatModel,
  streamLocalAgentTurn as streamAnthropicLocalAgentTurn,
} from "./chat/anthropic/localAgent";
import type { LocalChatStreamEvent, LocalContentPart } from "./chat/localTypes";

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
  files: Readonly<{
    create: () => Promise<Readonly<{ id: string; filename: string }>>;
  }>;
  responses: Readonly<{
    stream: (body: Readonly<Record<string, unknown>>) => AsyncIterable<FakeStreamEvent> & Readonly<{
      finalResponse: () => Promise<FakeFinalResponse>;
    }>;
  }>;
}> {
  let attemptIndex = 0;

  return {
    files: {
      async create() {
        return {
          id: "file_test_1",
          filename: "test.txt",
        };
      },
    },
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

type FakeAnthropicStreamEvent =
  | Readonly<{
    type: "content_block_delta";
    delta: Readonly<{
      type: "text_delta";
      text: string;
    }>;
  }>
  | Readonly<{ type: string }>;

type FakeAnthropicFinalMessage = Readonly<{
  content: ReadonlyArray<Readonly<{
    type: string;
    id?: string;
    name?: string;
    input?: unknown;
    text?: string;
  }>>;
  stop_reason: string | null;
}>;

type CapturedAnthropicStreamBody = Readonly<{
  model: string;
  system: string;
  messages: ReadonlyArray<unknown>;
  tools: ReadonlyArray<unknown>;
}>;

function makeFakeAnthropicClient(
  attempts: ReadonlyArray<Readonly<{
    events: ReadonlyArray<FakeAnthropicStreamEvent>;
    finalMessage: FakeAnthropicFinalMessage;
  }>>,
  capturedBodies: Array<CapturedAnthropicStreamBody>,
): Readonly<{
  beta: Readonly<{
    files: Readonly<{
      upload: () => Promise<Readonly<{ id: string }>>;
    }>;
    messages: Readonly<{
      stream: (body: Readonly<Record<string, unknown>>) => AsyncIterable<FakeAnthropicStreamEvent> & Readonly<{
        finalMessage: () => Promise<FakeAnthropicFinalMessage>;
      }>;
    }>;
  }>;
}> {
  let attemptIndex = 0;

  return {
    beta: {
      files: {
        async upload() {
          return { id: "file_test_1" };
        },
      },
      messages: {
        stream(body: Readonly<Record<string, unknown>>) {
          capturedBodies.push(body as CapturedAnthropicStreamBody);
          const attempt = attempts[attemptIndex];
          attemptIndex += 1;

          if (attempt === undefined) {
            throw new Error("Unexpected extra Anthropic stream attempt");
          }

          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<FakeAnthropicStreamEvent> {
              for (const event of attempt.events) {
                yield event;
              }
            },
            async finalMessage(): Promise<FakeAnthropicFinalMessage> {
              return attempt.finalMessage;
            },
          };
        },
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

function userTextContent(text: string): ReadonlyArray<LocalContentPart> {
  return [{ type: "text", text }];
}

test("isSupportedLocalChatModel accepts only OpenAI local-chat models", () => {
  assert.equal(isSupportedLocalChatModel("gpt-5.4"), true);
  assert.equal(isSupportedLocalChatModel("claude-sonnet-4-6"), false);
});

test("isSupportedAnthropicLocalChatModel accepts only Anthropic local-chat models", () => {
  assert.equal(isSupportedAnthropicLocalChatModel("claude-sonnet-4-6"), true);
  assert.equal(isSupportedAnthropicLocalChatModel("gpt-5.4"), false);
});

test("buildLocalSystemInstructions includes strict tool-call rules and examples", () => {
  const instructions = buildLocalSystemInstructions("Europe/Madrid", "ios");

  assert.match(instructions, /use this assistant on iphone\./i);
  assert.match(instructions, /the local device database is the source of truth for reads\./i);
  assert.match(instructions, /card side contract:/i);
  assert.match(instructions, /front side must contain only a question or recall prompt\./i);
  assert.match(instructions, /never include the answer on the front side\./i);
  assert.match(instructions, /make the front side specific enough that it stays unambiguous among many cards\./i);
  assert.match(instructions, /back side must contain the answer\./i);
  assert.match(instructions, /prefer a fenced markdown code block for structured examples\./i);
  assert.match(instructions, /Tool arguments must be exactly one JSON object\./);
  assert.match(instructions, /If a field is optional semantically, send null instead of omitting it\./);
  assert.match(instructions, /wait for explicit user confirmation before executing the write tool/i);
  assert.match(instructions, /before proposing or executing any new card or deck creation, you must first inspect the local workspace for exact or similar items/i);
  assert.match(instructions, /summarize what you found and discuss possible duplicates or overlap with the user/i);
  assert.match(instructions, /every newly proposed card must include at least one tag/i);
  assert.match(instructions, /if the user did not provide tags for a new card, you must suggest one or more concrete tags/i);
  assert.match(instructions, /you must reuse existing workspace tags when they fit; create a new tag only when no existing tag is appropriate/i);
  assert.match(instructions, /list_cards => \{"limit": 20\}/);
  assert.match(instructions, /get_cards => \{"cardIds": \["123e4567-e89b-42d3-a456-426614174000"\]\}/);
  assert.match(instructions, /search_cards => \{"query": "grammar", "limit": null\}/);
  assert.match(instructions, /search_decks => \{"query": "grammar", "limit": null\}/);
  assert.match(instructions, /get_decks => \{"deckIds": \["123e4567-e89b-42d3-a456-426614174001"\]\}/);
  assert.match(instructions, /list_review_history => \{"limit": 20, "cardId": null\}/);
  assert.match(instructions, /update_cards => \{"updates": \[\{"cardId": "123e4567-e89b-42d3-a456-426614174000"/);
  assert.match(instructions, /update_decks => \{"updates": \[\{"deckId": "123e4567-e89b-42d3-a456-426614174001"/);
  assert.match(instructions, /correct the tool call shape and continue without repeating earlier assistant text/i);
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
    messages: [{ role: "user", content: userTextContent("hi") }],
    model: "gpt-5.2",
    timezone: "Europe/Madrid",
    devicePlatform: "ios",
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
    messages: [{ role: "user", content: userTextContent("list my cards") }],
    model: "gpt-4.1-mini",
    timezone: "Europe/Madrid",
    devicePlatform: "ios",
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
    messages: [{ role: "user", content: userTextContent("list my cards") }],
    model: "gpt-5.4",
    timezone: "Europe/Madrid",
    devicePlatform: "ios",
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
        messages: [{ role: "user", content: userTextContent("list my cards") }],
        model: "gpt-5.4",
        timezone: "Europe/Madrid",
        devicePlatform: "ios",
        requestId: "request-4",
      }, client));
    },
    (error: unknown) => error instanceof LocalChatRuntimeError && error.code === "LOCAL_TOOL_CALL_INVALID" && error.stage === "tool_call_validation",
  );

  assert.equal(capturedBodies.length, 4);
});

test("streamAnthropicLocalAgentTurn emits tool requests and await_tool_results", async () => {
  const capturedBodies: Array<CapturedAnthropicStreamBody> = [];
  const client = makeFakeAnthropicClient(
    [{
      events: [{
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: "Inspecting local cards.",
        },
      }],
      finalMessage: {
        content: [{
          type: "tool_use",
          id: "toolu_1",
          name: "list_cards",
          input: { limit: null },
        }],
        stop_reason: "tool_use",
      },
    }],
    capturedBodies,
  );

  const events = await collectEvents(streamAnthropicLocalAgentTurn({
    messages: [{ role: "user", content: userTextContent("list my cards") }],
    model: "claude-sonnet-4-6",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    requestId: "request-anthropic-1",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Inspecting local cards." },
    { type: "tool_call_request", toolCallId: "toolu_1", name: "list_cards", input: "{\"limit\":null}" },
    { type: "await_tool_results" },
  ]);
  assert.equal(capturedBodies[0]?.model, "claude-sonnet-4-6");
  assert.match(String(capturedBodies[0]?.system), /browser/i);
});

test("streamAnthropicLocalAgentTurn retries malformed tool arguments", async () => {
  const capturedBodies: Array<CapturedAnthropicStreamBody> = [];
  const client = makeFakeAnthropicClient(
    [
      {
        events: [],
        finalMessage: {
          content: [{
            type: "tool_use",
            id: "toolu_1",
            name: "list_cards",
            input: {},
          }],
          stop_reason: "tool_use",
        },
      },
      {
        events: [],
        finalMessage: {
          content: [{
            type: "tool_use",
            id: "toolu_2",
            name: "list_cards",
            input: { limit: null },
          }],
          stop_reason: "tool_use",
        },
      },
    ],
    capturedBodies,
  );

  const events = await collectEvents(streamAnthropicLocalAgentTurn({
    messages: [{ role: "user", content: userTextContent("list my cards") }],
    model: "claude-sonnet-4-6",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    requestId: "request-anthropic-2",
  }, client));

  assert.deepEqual(events, [
    {
      type: "repair_attempt",
      message: "Assistant is correcting list_cards.",
      attempt: 1,
      maxAttempts: 3,
      toolName: "list_cards",
    },
    { type: "tool_call_request", toolCallId: "toolu_2", name: "list_cards", input: "{\"limit\":null}" },
    { type: "await_tool_results" },
  ]);
});

test("streamAnthropicLocalAgentTurn stops after three repair attempts", async () => {
  const capturedBodies: Array<CapturedAnthropicStreamBody> = [];
  const client = makeFakeAnthropicClient(
    [
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_1", name: "list_cards", input: {} }], stop_reason: "tool_use" } },
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_2", name: "list_cards", input: {} }], stop_reason: "tool_use" } },
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_3", name: "list_cards", input: {} }], stop_reason: "tool_use" } },
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_4", name: "list_cards", input: {} }], stop_reason: "tool_use" } },
    ],
    capturedBodies,
  );

  await assert.rejects(
    async () => {
      await collectEvents(streamAnthropicLocalAgentTurn({
        messages: [{ role: "user", content: userTextContent("list my cards") }],
        model: "claude-sonnet-4-6",
        timezone: "Europe/Madrid",
        devicePlatform: "web",
        requestId: "request-anthropic-3",
      }, client));
    },
    (error: unknown) => error instanceof AnthropicLocalChatRuntimeError
      && error.code === "LOCAL_TOOL_CALL_INVALID"
      && error.stage === "tool_call_validation",
  );
});

test("streamLocalChatResponse rejects only unknown local models", async () => {
  await assert.rejects(
    async () => {
      await streamLocalChatResponse(
        {
          messages: [{ role: "user", content: userTextContent("hi") }],
          model: "unknown-model",
          timezone: "Europe/Madrid",
          devicePlatform: "ios",
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
