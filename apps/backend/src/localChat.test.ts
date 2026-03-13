import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  createLocalChatErrorEvent,
  parseLocalChatDiagnosticsBody,
  parseLocalChatRequestBody,
  streamLocalChatResponse,
} from "./chat/http";
import {
  buildLocalSystemInstructions,
  decodeInlineTextAttachment,
  INLINE_TEXT_ATTACHMENT_MAX_BYTES,
  isInlineTextAttachmentCandidate,
} from "./chat/localRuntimeShared";
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

const testUserContext = {
  totalCards: 42,
} as const;

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

test("buildLocalSystemInstructions includes strict tool-call rules, examples, and user context", () => {
  const instructions = buildLocalSystemInstructions("Europe/Madrid", "ios", testUserContext);

  assert.match(instructions, /use this assistant on iphone\./i);
  assert.match(instructions, /User context:/);
  assert.match(instructions, /The current workspace has 42 cards\./);
  assert.match(instructions, /the local device database is the source of truth for reads\./i);
  assert.match(instructions, /card side contract:/i);
  assert.match(instructions, /front side must contain only a question or recall prompt\./i);
  assert.match(instructions, /never include the answer on the front side\./i);
  assert.match(instructions, /make the front side specific enough that it stays unambiguous among many cards\./i);
  assert.match(instructions, /back side must contain the answer\./i);
  assert.match(instructions, /prefer a fenced markdown code block for structured examples\./i);
  assert.match(instructions, /Tool arguments must be exactly one JSON object\./);
  assert.equal(
    instructions.match(/Before calling any tool, send one short user-facing sentence explaining what you are about to check\./g)?.length ?? 0,
    1,
  );
  assert.match(instructions, /wait for explicit user confirmation before executing the write tool/i);
  assert.match(instructions, /before proposing or executing any new card or deck creation, you must first inspect the local workspace for exact or similar items/i);
  assert.match(instructions, /summarize what you found and discuss possible duplicates or overlap with the user/i);
  assert.match(instructions, /every newly proposed card must include at least one tag/i);
  assert.match(instructions, /if the user did not provide tags for a new card, you must suggest one or more concrete tags/i);
  assert.match(instructions, /you must reuse existing workspace tags when they fit; create a new tag only when no existing tag is appropriate/i);
  assert.match(instructions, /sql => \{"sql": "SHOW TABLES"\}/);
  assert.match(instructions, /sql => \{"sql": "DESCRIBE workspace"\}/);
  assert.match(instructions, /sql => \{"sql": "SELECT \* FROM cards ORDER BY updated_at DESC LIMIT 20 OFFSET 0"\}/);
  assert.match(instructions, /sql => \{"sql": "SELECT card_id, front_text, back_text, tags FROM cards ORDER BY RANDOM\(\) LIMIT 3 OFFSET 0"\}/);
  assert.match(instructions, /sql => \{"sql": "SELECT \* FROM cards WHERE due_at IS NULL OR due_at <= NOW\(\) ORDER BY due_at ASC, updated_at DESC LIMIT 20 OFFSET 0"\}/);
  assert.match(instructions, /sql => \{"sql": "SELECT tag, COUNT\(\*\) AS cards_count FROM cards UNNEST tags AS tag GROUP BY tag ORDER BY cards_count DESC LIMIT 100 OFFSET 0"\}/);
  assert.match(instructions, /sql => \{"sql": "UPDATE cards SET back_text = 'Updated answer' WHERE card_id = '00000000-0000-4000-8000-000000000000'"\}/);
  assert.match(instructions, /correct the tool call shape and continue without repeating earlier assistant text/i);
  assert.match(instructions, /mounted files are typically exposed under \/mnt\/data/i);
  assert.match(instructions, /mounted filename may differ from the uploaded filename/i);
  assert.match(instructions, /inspect mounted files before claiming that an attached file is missing/i);
});

test("isInlineTextAttachmentCandidate accepts supported text-like files and excludes csv", () => {
  const supportedFiles = [
    { fileName: "notes.txt", mediaType: "text/plain" },
    { fileName: "notes.md", mediaType: "text/markdown" },
    { fileName: "data.json", mediaType: "application/json" },
    { fileName: "feed.xml", mediaType: "application/xml" },
    { fileName: "config.yaml", mediaType: "application/yaml" },
    { fileName: "config.yml", mediaType: "application/octet-stream" },
    { fileName: "query.sql", mediaType: "text/x-sql" },
    { fileName: "server.log", mediaType: "application/octet-stream" },
  ];

  for (const file of supportedFiles) {
    assert.equal(isInlineTextAttachmentCandidate({
      type: "file",
      fileName: file.fileName,
      mediaType: file.mediaType,
      base64Data: "dGVzdA==",
    }), true);
  }

  assert.equal(isInlineTextAttachmentCandidate({
    type: "file",
    fileName: "table.csv",
    mediaType: "text/csv",
    base64Data: "YSxiLGMKMSwyLDM=",
  }), false);
});

test("decodeInlineTextAttachment rejects oversized or invalid utf-8 files", () => {
  assert.equal(decodeInlineTextAttachment({
    type: "file",
    fileName: "big.txt",
    mediaType: "text/plain",
    base64Data: Buffer.alloc(INLINE_TEXT_ATTACHMENT_MAX_BYTES + 1, 65).toString("base64"),
  }), null);

  assert.equal(decodeInlineTextAttachment({
    type: "file",
    fileName: "broken.txt",
    mediaType: "text/plain",
    base64Data: Buffer.from([0xc3, 0x28]).toString("base64"),
  }), null);
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
    userContext: testUserContext,
    requestId: "request-1",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Hello" },
    { type: "delta", text: " world" },
    { type: "done" },
  ]);
  assert.equal(capturedBodies[0]?.model, "gpt-5.2");
  assert.equal(capturedBodies[0]?.parallel_tool_calls, false);
  assert.match(String(capturedBodies[0]?.instructions), /The current workspace has 42 cards\./);
});

test("streamLocalAgentTurn maps uploaded files to input_file with file_id only", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [{
      events: [],
      finalResponse: {
        output: [
          { type: "message" },
        ],
      },
    }],
    capturedBodies,
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{
      role: "user",
      content: [{
        type: "file",
        mediaType: "text/plain",
        base64Data: "dGVzdA==",
        fileName: "test.txt",
      }],
    }],
    model: "gpt-5.2",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    userContext: testUserContext,
    requestId: "request-file-1",
  }, client));

  assert.deepEqual(events, [
    { type: "done" },
  ]);

  const firstInputItem = capturedBodies[0]?.input[0] as Readonly<{
    type: string;
    role: string;
    content: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }> | undefined;
  const firstContentItem = firstInputItem?.content[0];

  assert.equal(firstInputItem?.type, "message");
  assert.equal(firstInputItem?.role, "user");
  assert.equal(firstContentItem?.type, "input_file");
  assert.equal(firstContentItem?.file_id, "file_test_1");
  assert.equal("filename" in (firstContentItem ?? {}), false);
});

test("streamLocalAgentTurn duplicates small text attachments inline and keeps them in code interpreter", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [{
      events: [],
      finalResponse: {
        output: [
          { type: "message" },
        ],
      },
    }],
    capturedBodies,
  );

  const events = await collectEvents(streamLocalAgentTurn({
    messages: [{
      role: "user",
      content: [{
        type: "file",
        mediaType: "text/plain",
        base64Data: Buffer.from("hello from file", "utf-8").toString("base64"),
        fileName: "test.txt",
      }],
    }],
    model: "gpt-5.2",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    userContext: testUserContext,
    requestId: "request-file-inline-1",
  }, client));

  assert.deepEqual(events, [
    { type: "done" },
  ]);

  const firstInputItem = capturedBodies[0]?.input[0] as Readonly<{
    content: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }> | undefined;
  const firstContent = firstInputItem?.content[0];
  const secondContent = firstInputItem?.content[1];
  const codeInterpreterTool = capturedBodies[0]?.tools.find((tool) => (
    typeof tool === "object" && tool !== null && "type" in tool && tool.type === "code_interpreter"
  )) as Readonly<{
    container: Readonly<{
      file_ids: ReadonlyArray<string>;
    }>;
  }> | undefined;

  assert.equal(firstContent?.type, "input_file");
  assert.equal(firstContent?.file_id, "file_test_1");
  assert.equal(secondContent?.type, "input_text");
  assert.match(String(secondContent?.text), /<attached_text_file name="test\.txt" media_type="text\/plain">/);
  assert.match(String(secondContent?.text), /hello from file/);
  assert.match(String(secondContent?.text), /mounted files are typically exposed under \/mnt\/data/i);
  assert.deepEqual(codeInterpreterTool?.container.file_ids, ["file_test_1"]);
});

test("streamLocalAgentTurn keeps csv attachments tool-only", async () => {
  const capturedBodies: Array<CapturedStreamBody> = [];
  const client = makeFakeClient(
    [{
      events: [],
      finalResponse: {
        output: [
          { type: "message" },
        ],
      },
    }],
    capturedBodies,
  );

  await collectEvents(streamLocalAgentTurn({
    messages: [{
      role: "user",
      content: [{
        type: "file",
        mediaType: "text/csv",
        base64Data: Buffer.from("a,b\n1,2", "utf-8").toString("base64"),
        fileName: "table.csv",
      }],
    }],
    model: "gpt-5.2",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    userContext: testUserContext,
    requestId: "request-file-csv-1",
  }, client));

  const firstInputItem = capturedBodies[0]?.input[0] as Readonly<{
    content: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }> | undefined;
  assert.equal(firstInputItem?.content.length, 1);
  assert.equal(firstInputItem?.content[0]?.type, "input_file");
});

test("streamAnthropicLocalAgentTurn duplicates small text attachments inline next to container uploads", async () => {
  const capturedBodies: Array<CapturedAnthropicStreamBody> = [];
  const client = makeFakeAnthropicClient(
    [{
      events: [],
      finalMessage: {
        content: [],
        stop_reason: null,
      },
    }],
    capturedBodies,
  );

  const events = await collectEvents(streamAnthropicLocalAgentTurn({
    messages: [{
      role: "user",
      content: [{
        type: "file",
        mediaType: "text/markdown",
        base64Data: Buffer.from("# Title", "utf-8").toString("base64"),
        fileName: "notes.md",
      }],
    }],
    model: "claude-sonnet-4-6",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    userContext: testUserContext,
    requestId: "request-anthropic-file-1",
  }, client));

  assert.deepEqual(events, [
    { type: "done" },
  ]);

  const firstMessage = capturedBodies[0]?.messages[0] as Readonly<{
    content: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }> | undefined;
  assert.equal(firstMessage?.content[0]?.type, "container_upload");
  assert.equal(firstMessage?.content[0]?.file_id, "file_test_1");
  assert.equal(firstMessage?.content[1]?.type, "text");
  assert.match(String(firstMessage?.content[1]?.text), /<attached_text_file name="notes\.md" media_type="text\/markdown">/);
  assert.match(String(firstMessage?.content[1]?.text), /The original file is also available to code execution\./);
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
              name: "sql",
              arguments: "{\"sql\":\"SHOW TABLES\"}\n{\"sql\":\"DESCRIBE cards\"}",
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
              name: "sql",
              arguments: "{\"sql\":\"SHOW TABLES\"}",
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
    userContext: testUserContext,
    requestId: "request-2",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Checking cards." },
    {
      type: "repair_attempt",
      message: "Assistant is correcting sql.",
      attempt: 1,
      maxAttempts: 3,
      toolName: "sql",
    },
    { type: "tool_call_request", toolCallId: "call-2", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" },
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
              name: "sql",
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
              name: "sql",
              arguments: "{\"sql\":\"SHOW TABLES\"}",
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
    userContext: testUserContext,
    requestId: "request-3",
  }, client));

  assert.deepEqual(events, [
    {
      type: "repair_attempt",
      message: "Assistant is correcting sql.",
      attempt: 1,
      maxAttempts: 3,
      toolName: "sql",
    },
    { type: "tool_call_request", toolCallId: "call-2", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" },
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
          output: [{ type: "function_call", call_id: "call-1", name: "sql", arguments: "{}" }],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-2", name: "sql", arguments: "{}" }],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-3", name: "sql", arguments: "{}" }],
        },
      },
      {
        events: [],
        finalResponse: {
          output: [{ type: "function_call", call_id: "call-4", name: "sql", arguments: "{}" }],
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
        userContext: testUserContext,
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
          name: "sql",
          input: { sql: "SHOW TABLES" },
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
    userContext: testUserContext,
    requestId: "request-anthropic-1",
  }, client));

  assert.deepEqual(events, [
    { type: "delta", text: "Inspecting local cards." },
    { type: "tool_call_request", toolCallId: "toolu_1", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" },
    { type: "await_tool_results" },
  ]);
  assert.equal(capturedBodies[0]?.model, "claude-sonnet-4-6");
  assert.match(String(capturedBodies[0]?.system), /browser/i);
  assert.match(String(capturedBodies[0]?.system), /The current workspace has 42 cards\./);
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
            name: "sql",
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
            name: "sql",
            input: { sql: "SHOW TABLES" },
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
    userContext: testUserContext,
    requestId: "request-anthropic-2",
  }, client));

  assert.deepEqual(events, [
    {
      type: "repair_attempt",
      message: "Assistant is correcting sql.",
      attempt: 1,
      maxAttempts: 3,
      toolName: "sql",
    },
    { type: "tool_call_request", toolCallId: "toolu_2", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" },
    { type: "await_tool_results" },
  ]);
});

test("streamAnthropicLocalAgentTurn stops after three repair attempts", async () => {
  const capturedBodies: Array<CapturedAnthropicStreamBody> = [];
  const client = makeFakeAnthropicClient(
    [
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_1", name: "sql", input: {} }], stop_reason: "tool_use" } },
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_2", name: "sql", input: {} }], stop_reason: "tool_use" } },
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_3", name: "sql", input: {} }], stop_reason: "tool_use" } },
      { events: [], finalMessage: { content: [{ type: "tool_use", id: "toolu_4", name: "sql", input: {} }], stop_reason: "tool_use" } },
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
        userContext: testUserContext,
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
          userContext: testUserContext,
        },
        "request-id",
      );
    },
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("parseLocalChatRequestBody requires a non-negative user card count", () => {
  const parsedBody = parseLocalChatRequestBody({
    messages: [{ role: "user", content: userTextContent("hi") }],
    model: "gpt-5.4",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    userContext: {
      totalCards: 7,
    },
  });

  assert.equal(parsedBody.userContext.totalCards, 7);

  assert.throws(
    () => {
      parseLocalChatRequestBody({
        messages: [{ role: "user", content: userTextContent("hi") }],
        model: "gpt-5.4",
        timezone: "Europe/Madrid",
        devicePlatform: "web",
        userContext: {
          totalCards: -1,
        },
      });
    },
    (error: unknown) => error instanceof HttpError && error.message === "userContext.totalCards must be a non-negative integer",
  );

  assert.throws(
    () => {
      parseLocalChatRequestBody({
        messages: [{ role: "user", content: userTextContent("hi") }],
        model: "gpt-5.4",
        timezone: "Europe/Madrid",
        devicePlatform: "web",
        userContext: {
          totalCards: "7",
        },
      });
    },
    (error: unknown) => error instanceof HttpError && error.message === "userContext.totalCards must be a non-negative integer",
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
    kind: "failure",
    clientRequestId: "client-1",
    backendRequestId: "backend-1",
    stage: "decoding_event_json",
    errorKind: "invalid_sse_event_json",
    statusCode: null,
    eventType: "tool_call_request",
    toolName: "sql",
    toolCallId: "call-1",
    lineNumber: 12,
    rawSnippet: "{\"type\":\"tool_call_request\"}",
    decoderSummary: "Unexpected character '{'",
    selectedModel: "gpt-5.4",
    messageCount: 2,
    appVersion: "0.1.0",
    devicePlatform: "ios",
  });

  assert.equal(body.kind, "failure");
  assert.equal(body.clientRequestId, "client-1");
  assert.equal(body.backendRequestId, "backend-1");
  if (body.kind !== "failure") {
    throw new Error("Expected failure diagnostics payload");
  }
  assert.equal(body.errorKind, "invalid_sse_event_json");
});

test("parseLocalChatDiagnosticsBody accepts local chat latency diagnostics payloads", () => {
  const body = parseLocalChatDiagnosticsBody({
    kind: "latency",
    clientRequestId: "client-1",
    backendRequestId: "backend-1",
    selectedModel: "gpt-5.4",
    messageCount: 2,
    appVersion: "0.1.0",
    devicePlatform: "web",
    result: "cancelled_before_first_delta",
    statusCode: 200,
    firstEventType: "repair_attempt",
    didReceiveFirstSseLine: true,
    didReceiveFirstDelta: false,
    tapToRequestStartMs: 10,
    requestStartToHeadersMs: 20,
    headersToFirstSseLineMs: 30,
    firstSseLineToFirstDeltaMs: null,
    requestStartToFirstDeltaMs: null,
    tapToFirstDeltaMs: null,
    requestStartToTerminalMs: 60,
    tapToTerminalMs: 70,
  });

  assert.equal(body.kind, "latency");
  if (body.kind !== "latency") {
    throw new Error("Expected latency diagnostics payload");
  }
  assert.equal(body.result, "cancelled_before_first_delta");
  assert.equal(body.firstEventType, "repair_attempt");
  assert.equal(body.didReceiveFirstSseLine, true);
  assert.equal(body.didReceiveFirstDelta, false);
});
