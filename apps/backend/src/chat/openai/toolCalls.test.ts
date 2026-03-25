import assert from "node:assert/strict";
import test from "node:test";
import {
  applyToolCallOutput,
  applyToolCallStarted,
  createToolCallStateMap,
} from "./toolCalls";

test("applyToolCallOutput uses explicit refreshRoute metadata for completed tool calls", () => {
  const started = applyToolCallStarted(
    createToolCallStateMap(),
    {
      type: "function_call",
      callId: "tool-1",
      id: "item-1",
      name: "sql",
      arguments: "{\"sql\":\"SELECT 1\"}",
    },
    {
      itemId: "item-1",
      responseIndex: 0,
      outputIndex: 0,
      sequenceNumber: 1,
    },
    100,
  );

  const completed = applyToolCallOutput(
    started.toolStates,
    {
      type: "function_call_output",
      callId: "tool-1",
      id: "item-1",
      name: "sql",
    },
    "{\"ok\":true}",
    150,
    true,
  );

  assert.equal(completed.event?.type, "tool_call");
  assert.equal(completed.event?.status, "completed");
  assert.equal(completed.event?.refreshRoute, true);
});

test("applyToolCallOutput does not infer refreshRoute from earlier tool-call input", () => {
  const started = applyToolCallStarted(
    createToolCallStateMap(),
    {
      type: "function_call",
      callId: "tool-1",
      id: "item-1",
      name: "sql",
      arguments: "{\"sql\":\"INSERT INTO cards VALUES ('x')\"}",
    },
    {
      itemId: "item-1",
      responseIndex: 0,
      outputIndex: 0,
      sequenceNumber: 1,
    },
    100,
  );

  const completed = applyToolCallOutput(
    started.toolStates,
    {
      type: "function_call_output",
      callId: "tool-1",
      id: "item-1",
      name: "sql",
    },
    "{\"ok\":false}",
    150,
    false,
  );

  assert.equal(completed.event?.type, "tool_call");
  assert.equal(completed.event?.status, "completed");
  assert.equal(completed.event?.refreshRoute, undefined);
});
