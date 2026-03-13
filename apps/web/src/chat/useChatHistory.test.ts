import { describe, expect, it } from "vitest";
import {
  appendAssistantErrorContent,
  OPTIMISTIC_ASSISTANT_STATUS_TEXT,
} from "./useChatHistory";

describe("appendAssistantErrorContent", () => {
  it("preserves prior tool calls and appends the error text", () => {
    expect(appendAssistantErrorContent(
      [
        { type: "text", text: "Running query." },
        {
          type: "tool_call",
          toolCallId: "tool-1",
          name: "sql",
          status: "completed",
          input: "{\"sql\":\"SHOW TABLES\"}",
          output: "{\"rows\":[]}",
        },
      ],
      "Projected SELECT statements must include aggregate functions",
    )).toEqual([
      { type: "text", text: "Running query." },
      {
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: "{\"rows\":[]}",
      },
      {
        type: "text",
        text: "Projected SELECT statements must include aggregate functions",
      },
    ]);
  });

  it("separates appended errors from trailing assistant text", () => {
    expect(appendAssistantErrorContent(
      [{ type: "text", text: "Assistant summary." }],
      "Tool execution failed",
    )).toEqual([
      { type: "text", text: "Assistant summary." },
      { type: "text", text: "\n\nTool execution failed" },
    ]);
  });

  it("replaces the optimistic status when the turn fails before any real content", () => {
    expect(appendAssistantErrorContent(
      [{ type: "text", text: OPTIMISTIC_ASSISTANT_STATUS_TEXT }],
      "Tool execution failed",
    )).toEqual([
      { type: "text", text: "Tool execution failed" },
    ]);
  });
});
