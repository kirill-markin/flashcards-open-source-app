import { describe, expect, it } from "vitest";
import { chatHistorySupportsLocalRuntime, parseLocalSSELine, toLocalChatMessages } from "./localRuntime";
import { normalizeStoredMessageForTests } from "./useChatHistory";
import type { StoredMessage } from "./useChatHistory";

describe("localRuntime", () => {
  it("preserves repeated tool names by toolCallId when converting history to local-turn wire messages", () => {
    const messages: ReadonlyArray<StoredMessage> = [{
      role: "assistant",
      content: [
        { type: "text", text: "Looking up cards." },
        { type: "tool_call", toolCallId: "call-1", name: "list_cards", status: "completed", input: "{\"limit\":10}", output: "[{\"cardId\":\"card-1\"}]" },
        { type: "tool_call", toolCallId: "call-2", name: "list_cards", status: "completed", input: "{\"limit\":20}", output: "[{\"cardId\":\"card-2\"}]" },
      ],
      timestamp: 1,
      isError: false,
    }];

    expect(toLocalChatMessages(messages)).toEqual([
      {
        role: "assistant",
        content: "Looking up cards.",
        toolCalls: [
          { toolCallId: "call-1", name: "list_cards", input: "{\"limit\":10}" },
          { toolCallId: "call-2", name: "list_cards", input: "{\"limit\":20}" },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "list_cards",
        output: "[{\"cardId\":\"card-1\"}]",
      },
      {
        role: "tool",
        toolCallId: "call-2",
        name: "list_cards",
        output: "[{\"cardId\":\"card-2\"}]",
      },
    ]);
  });

  it("drops legacy tool-call metadata without toolCallId while preserving plain text history", () => {
    const normalizedMessage = normalizeStoredMessageForTests({
      role: "assistant",
      content: [
        { type: "text", text: "Kept text" },
        { type: "tool_call", name: "list_cards", status: "completed", input: "{\"limit\":10}", output: "[]" },
      ],
      timestamp: 1,
      isError: false,
    });

    expect(normalizedMessage).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Kept text" }],
      timestamp: 1,
      isError: false,
    });
  });

  it("rejects local runtime for histories containing attachments and parses local SSE lines", () => {
    expect(chatHistorySupportsLocalRuntime([{
      role: "user",
      content: [{ type: "image", mediaType: "image/png", base64Data: "abc" }],
      timestamp: 1,
      isError: false,
    }])).toBe(false);

    expect(parseLocalSSELine("data: {\"type\":\"await_tool_results\"}")).toEqual({
      type: "await_tool_results",
    });
  });
});
