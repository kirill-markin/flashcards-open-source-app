import { describe, expect, it } from "vitest";
import { parseLocalSSELine, toLocalChatMessages } from "./localRuntime";
import { normalizeStoredMessageForTests } from "./useChatHistory";
import type { StoredMessage } from "./useChatHistory";

describe("localRuntime", () => {
  it("preserves repeated tool names by toolCallId when converting history to local-turn wire messages", () => {
    const messages: ReadonlyArray<StoredMessage> = [{
      role: "assistant",
      content: [
        { type: "text", text: "Running SQL." },
        { type: "tool_call", toolCallId: "call-1", name: "sql", status: "completed", input: "{\"sql\":\"SHOW TABLES\"}", output: "{\"rows\":[{\"table_name\":\"cards\"}]}" },
        { type: "tool_call", toolCallId: "call-2", name: "list_outbox", status: "completed", input: "{\"cursor\":null,\"limit\":20}", output: "{\"outbox\":[]}" },
      ],
      timestamp: 1,
      isError: false,
    }];

    expect(toLocalChatMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running SQL." },
          { type: "tool_call", toolCallId: "call-1", name: "sql", status: "completed", input: "{\"sql\":\"SHOW TABLES\"}", output: "{\"rows\":[{\"table_name\":\"cards\"}]}" },
          { type: "tool_call", toolCallId: "call-2", name: "list_outbox", status: "completed", input: "{\"cursor\":null,\"limit\":20}", output: "{\"outbox\":[]}" },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "sql",
        output: "{\"rows\":[{\"table_name\":\"cards\"}]}",
      },
      {
        role: "tool",
        toolCallId: "call-2",
        name: "list_outbox",
        output: "{\"outbox\":[]}",
      },
    ]);
  });

  it("drops legacy tool-call metadata without toolCallId while preserving plain text history", () => {
    const normalizedMessage = normalizeStoredMessageForTests({
      role: "assistant",
      content: [
        { type: "text", text: "Kept text" },
        { type: "tool_call", name: "sql", status: "completed", input: "{\"sql\":\"SHOW TABLES\"}", output: "[]" },
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

  it("merges adjacent assistant text parts while preserving paragraph boundaries", () => {
    const normalizedMessage = normalizeStoredMessageForTests({
      role: "assistant",
      content: [
        { type: "text", text: "Line one\r\n\r\n" },
        { type: "text", text: "Line two" },
      ],
      timestamp: 1,
      isError: false,
    });

    expect(normalizedMessage).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Line one\n\nLine two" }],
      timestamp: 1,
      isError: false,
    });
  });

  it("preserves attachments and parses local SSE lines", () => {
    expect(toLocalChatMessages([{
      role: "user",
      content: [{ type: "image", mediaType: "image/png", base64Data: "abc" }],
      timestamp: 1,
      isError: false,
    }])).toEqual([{
      role: "user",
      content: [{ type: "image", mediaType: "image/png", base64Data: "abc" }],
    }]);

    expect(parseLocalSSELine("data: {\"type\":\"await_tool_results\"}")).toEqual({
      type: "await_tool_results",
    });
  });
});
