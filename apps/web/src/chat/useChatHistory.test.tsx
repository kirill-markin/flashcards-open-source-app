// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ReasoningSummaryContentPart, ToolCallContentPart } from "../types";
import { useChatHistory } from "./useChatHistory";

type ChatHistoryApi = ReturnType<typeof useChatHistory>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHistoryHarness(): ChatHistoryApi {
  let latestApi: ChatHistoryApi | null = null;

  function Harness(): null {
    latestApi = useChatHistory();
    return null;
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Harness />);
  });

  if (latestApi === null) {
    throw new Error("Failed to initialize chat history test harness.");
  }

  return latestApi;
}

function createToolCallPart(params: Readonly<{
  id: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>): ToolCallContentPart {
  return {
    type: "tool_call",
    id: params.id,
    name: "sql",
    status: params.status,
    input: params.input,
    output: params.output,
    streamPosition: {
      itemId: "assistant-item-1",
      outputIndex: 0,
      contentIndex: null,
      sequenceNumber: null,
    },
  };
}

function createReasoningPart(params: Readonly<{
  reasoningId: string;
  summary: string;
  status: "started" | "completed";
}>): ReasoningSummaryContentPart {
  return {
    type: "reasoning_summary",
    reasoningId: params.reasoningId,
    summary: params.summary,
    status: params.status,
    streamPosition: {
      itemId: params.reasoningId,
      outputIndex: 0,
      contentIndex: null,
      sequenceNumber: null,
    },
  };
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe("useChatHistory", () => {
  it("replaces a started tool call with the completed snapshot when ids match", () => {
    const api = renderHistoryHarness();

    act(() => {
      api.startAssistantMessage(null);
      api.upsertAssistantToolCall(createToolCallPart({
        id: "tool-1",
        status: "started",
        input: null,
        output: null,
      }));
      api.upsertAssistantToolCall(createToolCallPart({
        id: "tool-1",
        status: "completed",
        input: "{\"sql\":\"SELECT COUNT(*) FROM cards\"}",
        output: "{\"rows\":[{\"count\":1822}]}",
      }));
    });

    const assistantMessage = api.messages.at(-1);
    const toolCalls = assistantMessage?.content.filter((part) => part.type === "tool_call") ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      id: "tool-1",
      status: "completed",
      input: "{\"sql\":\"SELECT COUNT(*) FROM cards\"}",
    });
  });

  it("keeps one reasoning block and removes empty placeholders on completion", () => {
    const api = renderHistoryHarness();

    act(() => {
      api.startAssistantMessage(null);
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-1",
        summary: "",
        status: "started",
      }));
      api.completeAssistantReasoningSummary("reasoning-1");
    });

    let assistantMessage = api.messages.at(-1);
    let reasoningParts = assistantMessage?.content.filter((part) => part.type === "reasoning_summary") ?? [];
    expect(reasoningParts).toHaveLength(0);

    act(() => {
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-2",
        summary: "",
        status: "started",
      }));
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-2",
        summary: "Checked the workspace card count.",
        status: "started",
      }));
      api.completeAssistantReasoningSummary("reasoning-2");
    });

    assistantMessage = api.messages.at(-1);
    reasoningParts = assistantMessage?.content.filter((part) => part.type === "reasoning_summary") ?? [];
    expect(reasoningParts).toHaveLength(1);
    expect(reasoningParts[0]).toMatchObject({
      reasoningId: "reasoning-2",
      summary: "Checked the workspace card count.",
      status: "completed",
    });
  });
});
