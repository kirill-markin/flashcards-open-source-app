// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReasoningSummaryContentPart, ToolCallContentPart } from "../types";
import { useChatHistory } from "./useChatHistory";

type ChatHistoryApi = ReturnType<typeof useChatHistory>;
type ChatHistoryHarness = Readonly<{
  getApi: () => ChatHistoryApi;
}>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHistoryHarness(): ChatHistoryHarness {
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

  return {
    getApi(): ChatHistoryApi {
      if (latestApi === null) {
        throw new Error("Expected chat history api to be available.");
      }

      return latestApi;
    },
  };
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

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

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
    const harness = renderHistoryHarness();

    act(() => {
      const api = harness.getApi();
      api.startAssistantMessage(null);
      api.appendAssistantText("", "assistant-item-1", "cursor-1");
      api.upsertAssistantToolCall(createToolCallPart({
        id: "tool-1",
        status: "started",
        input: null,
        output: null,
      }), "assistant-item-1", "cursor-1");
      api.upsertAssistantToolCall(createToolCallPart({
        id: "tool-1",
        status: "completed",
        input: "{\"sql\":\"SELECT COUNT(*) FROM cards\"}",
        output: "{\"rows\":[{\"count\":1822}]}",
      }), "assistant-item-1", "cursor-1");
    });

    const assistantMessage = harness.getApi().messages.at(-1);
    const toolCalls = assistantMessage?.content.filter((part) => part.type === "tool_call") ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      id: "tool-1",
      status: "completed",
      input: "{\"sql\":\"SELECT COUNT(*) FROM cards\"}",
    });
  });

  it("keeps one reasoning block and removes empty placeholders on completion", () => {
    const harness = renderHistoryHarness();

    act(() => {
      const api = harness.getApi();
      api.startAssistantMessage(null);
      api.appendAssistantText("", "assistant-item-1", "cursor-1");
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-1",
        summary: "",
        status: "started",
      }), "assistant-item-1", "cursor-1");
      api.completeAssistantReasoningSummary("reasoning-1", "assistant-item-1", "cursor-1");
    });

    let assistantMessage = harness.getApi().messages.at(-1);
    let reasoningParts = assistantMessage?.content.filter((part) => part.type === "reasoning_summary") ?? [];
    expect(reasoningParts).toHaveLength(0);

    act(() => {
      const api = harness.getApi();
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-2",
        summary: "",
        status: "started",
      }), "assistant-item-1", "cursor-1");
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-2",
        summary: "Checked the workspace card count.",
        status: "started",
      }), "assistant-item-1", "cursor-1");
      api.completeAssistantReasoningSummary("reasoning-2", "assistant-item-1", "cursor-1");
    });

    assistantMessage = harness.getApi().messages.at(-1);
    reasoningParts = assistantMessage?.content.filter((part) => part.type === "reasoning_summary") ?? [];
    expect(reasoningParts).toHaveLength(1);
    expect(reasoningParts[0]).toMatchObject({
      reasoningId: "reasoning-2",
      summary: "Checked the workspace card count.",
      status: "completed",
    });
  });

  it("keeps a later reasoning block after existing assistant text", () => {
    const harness = renderHistoryHarness();

    act(() => {
      const api = harness.getApi();
      api.startAssistantMessage(null);
      api.appendAssistantText("I'm checking your due cards and deck structure.", "assistant-item-1", "cursor-1");
      api.upsertAssistantReasoningSummary(createReasoningPart({
        reasoningId: "reasoning-1",
        summary: "Checked the due queue.",
        status: "started",
      }), "assistant-item-1", "cursor-1");
    });

    const assistantMessage = harness.getApi().messages.at(-1);
    // This order is intentional: the UI renders assistant content in array order,
    // so reasoning must stay after text if it arrived later.
    expect(assistantMessage?.content.map((part) => part.type)).toEqual([
      "text",
      "reasoning_summary",
    ]);
    expect(assistantMessage?.content).toMatchObject([
      { type: "text", text: "I'm checking your due cards and deck structure." },
      {
        type: "reasoning_summary",
        reasoningId: "reasoning-1",
        summary: "Checked the due queue.",
        status: "started",
      },
    ]);
  });

  it("applies canonical terminal content over the optimistic placeholder", () => {
    const harness = renderHistoryHarness();

    act(() => {
      const api = harness.getApi();
      api.startAssistantMessage(null);
      api.appendAssistantText("Partial text", "assistant-item-1", "cursor-1");
    });

    let didFinish = false;
    act(() => {
      const api = harness.getApi();
      didFinish = api.finishAssistantMessage(
        [{ type: "text", text: "Final server answer." }],
        "assistant-item-1",
        "cursor-1",
        false,
        false,
      );
    });

    expect(didFinish).toBe(true);
    expect(harness.getApi().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Final server answer." }],
      itemId: "assistant-item-1",
      cursor: "cursor-1",
      isError: false,
      isStopped: false,
    });
  });

  it("requires reconciliation when terminal success content is not renderable", () => {
    const harness = renderHistoryHarness();

    act(() => {
      const api = harness.getApi();
      api.startAssistantMessage(null);
      api.appendAssistantText("", "assistant-item-1", "cursor-1");
    });

    let didFinish = true;
    act(() => {
      const api = harness.getApi();
      didFinish = api.finishAssistantMessage(
        [{ type: "text", text: "   " }],
        "assistant-item-1",
        "cursor-1",
        false,
        false,
      );
    });

    expect(didFinish).toBe(false);
  });
});
