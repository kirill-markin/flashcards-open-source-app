import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import {
  normalizeStoredOpenAIReplayItems,
  toStoredOpenAIReplayItem,
} from "./replayItems";

test("toStoredOpenAIReplayItem stores stateless replay-safe items without provider ids", () => {
  const reasoningItem = toStoredOpenAIReplayItem({
    id: "rs_123",
    type: "reasoning",
    summary: [],
    encrypted_content: "enc_123",
    status: "completed",
  });
  const toolCallItem = toStoredOpenAIReplayItem({
    id: "fc_123",
    type: "function_call",
    call_id: "call_123",
    name: "sql",
    arguments: "{\"sql\":\"SELECT 1\"}",
    status: "completed",
  });
  const messageItem = toStoredOpenAIReplayItem({
    id: "msg_123",
    type: "message",
    role: "assistant",
    status: "completed",
    phase: "final_answer",
    content: [{
      type: "output_text",
      text: "All done.",
      annotations: [],
    }],
  });

  assert.deepEqual(reasoningItem, {
    type: "reasoning",
    summary: [],
    encrypted_content: "enc_123",
    status: "completed",
  });
  assert.deepEqual(toolCallItem, {
    type: "function_call",
    call_id: "call_123",
    name: "sql",
    arguments: "{\"sql\":\"SELECT 1\"}",
    status: "completed",
  });
  assert.deepEqual(messageItem, {
    type: "message",
    role: "assistant",
    status: "completed",
    phase: "final_answer",
    content: [{
      type: "output_text",
      text: "All done.",
      annotations: [],
    }],
  });
});

test("normalizeStoredOpenAIReplayItems strips legacy ids and drops reasoning without encrypted content", () => {
  const legacyItems: ReadonlyArray<
    | OpenAI.Responses.ResponseReasoningItem
    | OpenAI.Responses.ResponseFunctionToolCall
    | OpenAI.Responses.ResponseOutputMessage
  > = [
    {
      id: "rs_missing",
      type: "reasoning",
      summary: [],
    },
    {
      id: "fc_123",
      type: "function_call",
      call_id: "call_123",
      name: "sql",
      arguments: "{\"sql\":\"SELECT 1\"}",
      status: "completed",
    },
    {
      id: "msg_123",
      type: "message",
      role: "assistant",
      status: "completed",
      phase: "commentary",
      content: [{
        type: "output_text",
        text: "Intermediate update",
        annotations: [],
      }],
    },
  ];

  assert.deepEqual(normalizeStoredOpenAIReplayItems(legacyItems), {
    items: [
      {
        type: "function_call",
        call_id: "call_123",
        name: "sql",
        arguments: "{\"sql\":\"SELECT 1\"}",
        status: "completed",
      },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        phase: "commentary",
        content: [{
          type: "output_text",
          text: "Intermediate update",
          annotations: [],
        }],
      },
    ],
    droppedReasoningItems: 1,
  });
});
