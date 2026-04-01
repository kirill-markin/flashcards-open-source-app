import assert from "node:assert/strict";
import test from "node:test";
import { diffAssistantContent } from "./chat/liveDiff";
import type { ContentPart } from "./chat/types";

function createToolCallPart(params: Readonly<{
  id: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>): Extract<ContentPart, { type: "tool_call" }> {
  return {
    type: "tool_call",
    id: params.id,
    name: "sql",
    status: params.status,
    input: params.input,
    output: params.output,
    streamPosition: {
      itemId: "provider-tool-item-1",
      outputIndex: 0,
      contentIndex: null,
      sequenceNumber: 1,
    },
  };
}

function createReasoningPart(summary: string): Extract<ContentPart, { type: "reasoning_summary" }> {
  return {
    type: "reasoning_summary",
    summary,
    streamPosition: {
      itemId: "provider-reasoning-item-1",
      outputIndex: 0,
      contentIndex: null,
      sequenceNumber: 1,
    },
  };
}

test("diffAssistantContent emits one completed tool update for an existing tool call", () => {
  const previous: ReadonlyArray<ContentPart> = [
    createToolCallPart({
      id: "tool-1",
      status: "started",
      input: "{\"",
      output: null,
    }),
  ];
  const current: ReadonlyArray<ContentPart> = [
    createToolCallPart({
      id: "tool-1",
      status: "completed",
      input: "{\"sql\":\"SELECT COUNT(*) FROM cards\"}",
      output: "{\"rows\":[{\"count\":1822}]}",
    }),
  ];

  assert.deepEqual(
    diffAssistantContent(previous, current, "42", "assistant-item-1"),
    [{
      type: "assistant_tool_call",
      toolCallId: "tool-1",
      name: "sql",
      status: "completed",
      input: "{\"sql\":\"SELECT COUNT(*) FROM cards\"}",
      output: "{\"rows\":[{\"count\":1822}]}",
      providerStatus: null,
      cursor: "42",
      itemId: "assistant-item-1",
      outputIndex: 0,
    }],
  );
});

test("diffAssistantContent reconstructs one started then completed tool call from a completed snapshot", () => {
  const current: ReadonlyArray<ContentPart> = [
    createToolCallPart({
      id: "tool-1",
      status: "completed",
      input: "{\"sql\":\"SELECT 1\"}",
      output: "{\"rows\":[{\"?column?\":1}]}",
    }),
  ];

  assert.deepEqual(
    diffAssistantContent([], current, "42", "assistant-item-1"),
    [
      {
        type: "assistant_tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "started",
        input: null,
        output: null,
        cursor: "42",
        itemId: "assistant-item-1",
        outputIndex: 0,
      },
      {
        type: "assistant_tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SELECT 1\"}",
        output: "{\"rows\":[{\"?column?\":1}]}",
        providerStatus: null,
        cursor: "42",
        itemId: "assistant-item-1",
        outputIndex: 0,
      },
    ],
  );
});

test("diffAssistantContent emits reasoning lifecycle events from placeholder to completed summary", () => {
  const previous: ReadonlyArray<ContentPart> = [
    createReasoningPart(""),
  ];
  const current: ReadonlyArray<ContentPart> = [
    createReasoningPart("Checked the workspace card count."),
    {
      type: "text",
      text: "You have 1,822 cards.",
      streamPosition: {
        itemId: "assistant-output-text-1",
        outputIndex: 1,
        contentIndex: 0,
        sequenceNumber: 2,
      },
    },
  ];

  assert.deepEqual(
    diffAssistantContent(previous, current, "42", "assistant-item-1"),
    [
      {
        type: "assistant_reasoning_summary",
        reasoningId: "provider-reasoning-item-1",
        summary: "Checked the workspace card count.",
        cursor: "42",
        itemId: "assistant-item-1",
        outputIndex: 0,
      },
      {
        type: "assistant_reasoning_done",
        reasoningId: "provider-reasoning-item-1",
        cursor: "42",
        itemId: "assistant-item-1",
        outputIndex: 0,
      },
      {
        type: "assistant_delta",
        text: "You have 1,822 cards.",
        cursor: "42",
        itemId: "assistant-item-1",
      },
    ],
  );
});
