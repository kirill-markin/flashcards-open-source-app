import { describe, expect, it } from "vitest";
import { parseAIChatSSELine, toAIChatMessages } from "./aiChatWire";
import { normalizeStoredMessageForTests } from "./useChatHistory";
import type { StoredMessage } from "./useChatHistory";

describe("aiChatWire", () => {
  it("drops assistant tool-call parts when converting history to the chat wire format", () => {
    const messages: ReadonlyArray<StoredMessage> = [{
      role: "assistant",
      content: [
        { type: "text", text: "Running SQL." },
        { type: "tool_call", toolCallId: "call-1", name: "sql", status: "completed", input: "{\"sql\":\"SHOW TABLES\"}", output: "{\"rows\":[{\"table_name\":\"cards\"}]}" },
      ],
      timestamp: 1,
      isError: false,
    }];

    expect(toAIChatMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running SQL." },
        ],
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

  it("preserves attachments and parses chat SSE lines", () => {
    expect(toAIChatMessages([{
      role: "user",
      content: [{ type: "image", mediaType: "image/png", base64Data: "abc" }],
      timestamp: 1,
      isError: false,
    }])).toEqual([{
      role: "user",
      content: [{ type: "image", mediaType: "image/png", base64Data: "abc" }],
    }]);

    expect(parseAIChatSSELine("data: {\"type\":\"done\"}")).toEqual({
      type: "done",
    });
  });
});
