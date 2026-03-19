import assert from "node:assert/strict";
import test from "node:test";
import { buildAIChatSystemInstructions } from "./chat/aiChatRuntimeShared";
import {
  createAIChatErrorEvent,
  createAIChatErrorResponse,
  parseAIChatDiagnosticsBody,
  parseAIChatTurnRequestBody,
  streamAIChatResponse,
} from "./chat/http";
import { HttpError } from "./errors";
import { isSupportedAIChatModel as isSupportedAnthropicAIChatModel } from "./chat/anthropic/aiChatAgent";
import { isSupportedAIChatModel as isSupportedOpenAIChatModel } from "./chat/openai/aiChatAgent";

test("parseAIChatTurnRequestBody rejects tool-role history", () => {
  assert.throws(
    () => parseAIChatTurnRequestBody({
      messages: [{
        role: "tool",
        toolCallId: "tool-1",
        name: "sql",
        output: "{}",
      }],
      model: "gpt-5.4",
      timezone: "Europe/Madrid",
      devicePlatform: "web",
      chatSessionId: "chat-session-1",
      codeInterpreterContainerId: null,
      userContext: { totalCards: 1 },
    }),
    /messages\[0\]\.role is invalid/,
  );
});

test("parseAIChatTurnRequestBody accepts assistant tool-call parts without continuation messages", () => {
  const parsed = parseAIChatTurnRequestBody({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hi" }],
      },
      {
        role: "assistant",
        content: [{
          type: "tool_call",
          toolCallId: "tool-1",
          name: "sql",
          status: "completed",
          input: "{\"sql\":\"SELECT 1\"}",
          output: "{\"ok\":true}",
        }],
      },
    ],
    model: "gpt-5.4",
    timezone: "Europe/Madrid",
    devicePlatform: "web",
    chatSessionId: "chat-session-1",
    codeInterpreterContainerId: null,
    userContext: { totalCards: 3 },
  });

  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[1]?.role, "assistant");
});

test("createAIChatErrorEvent keeps the machine-readable fields", () => {
  assert.deepEqual(
    createAIChatErrorEvent(
      "boom",
      "request-123",
      "AI_CHAT_STREAM_FAILED",
      "stream_ai_chat_turn",
    ),
    {
      type: "error",
      message: "boom",
      code: "AI_CHAT_STREAM_FAILED",
      stage: "stream_ai_chat_turn",
      requestId: "request-123",
    },
  );
});

test("createAIChatErrorResponse streams a single SSE error event", async () => {
  const response = createAIChatErrorResponse(
    "boom",
    "request-123",
    "AI_CHAT_STREAM_FAILED",
    "stream_ai_chat_turn",
  );

  assert.equal(response.status, 500);
  const body = await response.text();
  assert.match(body, /"type":"error"/);
  assert.match(body, /"requestId":"request-123"/);
});

test("parseAIChatDiagnosticsBody accepts failure payloads without continuation tool ids", () => {
  const payload = parseAIChatDiagnosticsBody({
    kind: "failure",
    clientRequestId: "client-1",
    backendRequestId: "backend-1",
    stage: "stream_ai_chat_turn",
    errorKind: "backend_error_event",
    statusCode: 500,
    eventType: "error",
    toolName: null,
    toolCallId: null,
    lineNumber: null,
    rawSnippet: null,
    decoderSummary: "boom",
    selectedModel: "gpt-5.4",
    messageCount: 2,
    appVersion: "1.0.0",
    devicePlatform: "web",
  });

  assert.equal(payload.kind, "failure");
  assert.deepEqual(payload.continuationToolCallIds, []);
});

test("isSupportedOpenAIChatModel accepts only OpenAI AI chat models", () => {
  assert.equal(isSupportedOpenAIChatModel("gpt-5.4"), true);
  assert.equal(isSupportedOpenAIChatModel("claude-sonnet-4-6"), false);
});

test("isSupportedAnthropicAIChatModel accepts only Anthropic AI chat models", () => {
  assert.equal(isSupportedAnthropicAIChatModel("claude-sonnet-4-6"), true);
  assert.equal(isSupportedAnthropicAIChatModel("gpt-5.4"), false);
});

test("buildAIChatSystemInstructions prefers existing tags and requires approval for new ones", () => {
  const instructions = buildAIChatSystemInstructions(
    "Europe/Madrid",
    "web",
    { totalCards: 10 },
  );

  assert.match(
    instructions,
    /By default, you must reuse existing workspace tags whenever that is possible and logically fits the card\./i,
  );
  assert.match(
    instructions,
    /You must create a new tag only when no existing workspace tag is appropriate, and you must ask the user to approve that new tag before proposing or executing it\./i,
  );
});

test("streamAIChatResponse rejects guest chat immediately when guest AI quota defaults to zero", async () => {
  const originalGuestAiWeightedMonthlyTokenCap = process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;

  await assert.rejects(
    async () => streamAIChatResponse(
      {
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        model: "gpt-5.4",
        timezone: "Europe/Madrid",
        devicePlatform: "web",
        chatSessionId: "chat-session-1",
        codeInterpreterContainerId: null,
        userContext: { totalCards: 1 },
      },
      "request-1",
      {
        userId: "guest-user-1",
        subjectUserId: "guest-user-1",
        selectedWorkspaceId: "workspace-1",
        email: null,
        locale: "en",
        userSettingsCreatedAt: "2026-03-12T10:00:00.000Z",
        transport: "guest",
        connectionId: null,
      },
      "https://api.example.com/chat/turn",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 429
      && error.code === "GUEST_AI_LIMIT_REACHED"
      && error.message === "Your free monthly AI limit is used up on this device. Create an account to keep going.",
  );

  if (originalGuestAiWeightedMonthlyTokenCap === undefined) {
    delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  } else {
    process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = originalGuestAiWeightedMonthlyTokenCap;
  }
});
