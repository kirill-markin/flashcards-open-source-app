import assert from "node:assert/strict";
import test from "node:test";
import type { StreamPosition } from "./types";
import {
  appendAssistantTextContent,
  finalizePendingToolCallContent,
  upsertReasoningSummaryContent,
  upsertToolCallContent,
} from "./history";

const createStreamPosition = (
  itemId: string,
  outputIndex: number,
  contentIndex: number | null,
  sequenceNumber: number | null,
): StreamPosition => ({
  itemId,
  outputIndex,
  contentIndex,
  sequenceNumber,
});

test("appendAssistantTextContent appends deltas into the same text slot", () => {
  const initial = appendAssistantTextContent([], {
    text: "Hel",
    streamPosition: createStreamPosition("msg-1", 0, 0, 10),
  });

  assert.deepEqual(
    appendAssistantTextContent(initial, {
      text: "lo",
      streamPosition: createStreamPosition("msg-1", 0, 0, 11),
    }),
    [{
      type: "text",
      text: "Hello",
      streamPosition: createStreamPosition("msg-1", 0, 0, 10),
    }],
  );
});

test("ordered assistant content preserves tool-thinking-tool chronology", () => {
  const firstTool = upsertToolCallContent([], {
    type: "tool_call",
    id: "tool-1",
    name: "query_database",
    status: "completed",
    providerStatus: "completed",
    input: "{\"sql\":\"SELECT 1\"}",
    output: "{\"rows\":[1]}",
    streamPosition: createStreamPosition("tool-1-item", 0, null, 10),
  });
  const withReasoning = upsertReasoningSummaryContent(firstTool, {
    type: "reasoning_summary",
    summary: "Compared the first tool output before continuing.",
    streamPosition: createStreamPosition("reasoning-1", 1, null, 20),
  });

  assert.deepEqual(
    upsertToolCallContent(withReasoning, {
      type: "tool_call",
      id: "tool-2",
      name: "query_database",
      status: "completed",
      providerStatus: "completed",
      input: "{\"sql\":\"SELECT 2\"}",
      output: "{\"rows\":[2]}",
      streamPosition: createStreamPosition("tool-2-item", 2, null, 30),
    }),
    [
      {
        type: "tool_call",
        id: "tool-1",
        name: "query_database",
        status: "completed",
        providerStatus: "completed",
        input: "{\"sql\":\"SELECT 1\"}",
        output: "{\"rows\":[1]}",
        streamPosition: createStreamPosition("tool-1-item", 0, null, 10),
      },
      {
        type: "reasoning_summary",
        summary: "Compared the first tool output before continuing.",
        streamPosition: createStreamPosition("reasoning-1", 1, null, 20),
      },
      {
        type: "tool_call",
        id: "tool-2",
        name: "query_database",
        status: "completed",
        providerStatus: "completed",
        input: "{\"sql\":\"SELECT 2\"}",
        output: "{\"rows\":[2]}",
        streamPosition: createStreamPosition("tool-2-item", 2, null, 30),
      },
    ],
  );
});

test("finalizePendingToolCallContent completes started tool calls with fallback output", () => {
  assert.deepEqual(
    finalizePendingToolCallContent([{
      type: "tool_call",
      id: "tool-1",
      name: "query_database",
      status: "started",
      providerStatus: "in_progress",
      input: "{\"sql\":\"SELECT 1\"}",
      output: null,
      streamPosition: createStreamPosition("tool-1-item", 0, null, 10),
    }], "incomplete", "Stopped by user"),
    [{
      type: "tool_call",
      id: "tool-1",
      name: "query_database",
      status: "completed",
      providerStatus: "incomplete",
      input: "{\"sql\":\"SELECT 1\"}",
      output: "Stopped by user",
      streamPosition: createStreamPosition("tool-1-item", 0, null, 10),
    }],
  );
});
