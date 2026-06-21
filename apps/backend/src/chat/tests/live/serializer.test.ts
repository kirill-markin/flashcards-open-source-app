import assert from "node:assert/strict";
import test from "node:test";
import { createChatLiveEventSerializer } from "../../contract";
import { formatSSEEvent } from "../../live/transport";

function parseSerializedEvent(value: string): unknown {
  const dataLine = value
    .split("\n")
    .find((line) => line.startsWith("data: "));
  assert.notEqual(dataLine, undefined);
  return JSON.parse(dataLine!.slice(6)) as unknown;
}

test("assistant_message_done live serialization keeps legacy card effortLevel", () => {
  const serialize = createChatLiveEventSerializer({
    sessionId: "session-1",
    conversationScopeId: "session-1",
    runId: "run-1",
    streamEpoch: "run-1",
  });

  const event = serialize({
    type: "assistant_message_done",
    cursor: "6",
    itemId: "assistant-1",
    content: [{
      type: "card",
      cardId: "card-1",
      frontText: "What is Rust?",
      backText: "A systems programming language.",
      tags: ["lang", "systems"],
    }],
    isError: false,
    isStopped: false,
  });

  assert.deepEqual(parseSerializedEvent(formatSSEEvent(event)), {
    type: "assistant_message_done",
    sessionId: "session-1",
    conversationScopeId: "session-1",
    runId: "run-1",
    cursor: "6",
    sequenceNumber: 1,
    streamEpoch: "run-1",
    itemId: "assistant-1",
    content: [{
      type: "card",
      cardId: "card-1",
      frontText: "What is Rust?",
      backText: "A systems programming language.",
      tags: ["lang", "systems"],
      effortLevel: "fast",
    }],
    isError: false,
    isStopped: false,
  });
});
