// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  createSSELine,
  createStreamResponse,
  createTimedStreamResponse,
  executeLocalToolMock,
  setupChatPanelTest,
  streamDeltaPayload,
  streamLocalChatMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel tool calls", () => {
  it("keeps tool call blocks in order relative to assistant text without trimming", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [
        { type: "text", text: "Before tool\n\n" },
        {
          type: "tool_call",
          toolCallId: "tool-1",
          name: "sql",
          status: "completed",
          input: "{\"sql\":\"SHOW TABLES\"}",
          output: "{\"rows\":[{\"table_name\":\"cards\"}]}",
        },
        { type: "text", text: "\n\nAfter tool\n\n" },
      ],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const assistantMessage = chatPanel.getContainer().querySelector(".chat-msg-assistant");
    expect(assistantMessage).not.toBeNull();
    if (assistantMessage === null) {
      throw new Error("Expected assistant message");
    }

    const children = [...assistantMessage.children];
    expect(children).toHaveLength(3);
    expect(children[0]?.tagName).toBe("SPAN");
    expect(children[0]?.textContent).toBe("Before tool\n\n");
    expect(children[1]?.tagName).toBe("DETAILS");
    const toolDetails = children[1] as HTMLDetailsElement;
    expect(toolDetails.querySelector(".chat-tool-call-summary-main")?.textContent).toBe("SQL: SHOW TABLES");
    expect(toolDetails.querySelector(".chat-tool-call-section-title")?.textContent).toBe("Request");
    expect(toolDetails.querySelector(".chat-tool-call-input")?.textContent).toBe("{\"sql\":\"SHOW TABLES\"}");
    expect(toolDetails.querySelector(".chat-tool-call-output")?.textContent).toBe("{\"rows\":[{\"table_name\":\"cards\"}]}");
    expect(children[2]?.tagName).toBe("SPAN");
    expect(children[2]?.textContent).toBe("\n\nAfter tool\n\n");
  });

  it("renders a pending tool block immediately and upgrades it in place after completion", async () => {
    const deferredToolResult = createDeferred<Readonly<{
      output: string;
      didMutateAppState: boolean;
    }>>();
    executeLocalToolMock.mockImplementationOnce(() => deferredToolResult.promise);
    streamLocalChatMock
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ], 200))
      .mockResolvedValueOnce(createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("Done") }], 1, 200));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("run sql");

    const mountedContainer = chatPanel.getContainer();
    const pendingToolCall = mountedContainer.querySelector(".chat-tool-call-started");
    expect(pendingToolCall).not.toBeNull();
    expect(pendingToolCall?.querySelector(".chat-tool-call-summary-main")?.textContent).toBe("SQL: SHOW TABLES");
    expect(pendingToolCall?.textContent).toContain("Running");
    expect(mountedContainer.querySelectorAll(".chat-tool-call")).toHaveLength(1);
    expect(mountedContainer.textContent).not.toContain("Looking through your cards...");

    await act(async () => {
      deferredToolResult.resolve({
        output: "{\"rows\":[]}",
        didMutateAppState: false,
      });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    expect(mountedContainer.querySelectorAll(".chat-tool-call")).toHaveLength(1);
    expect(mountedContainer.querySelector(".chat-tool-call-started")).toBeNull();
    expect(mountedContainer.querySelector(".chat-tool-call-completed")?.textContent).toContain("Done");
    expect(mountedContainer.textContent).toContain("Done");
  });

  it("keeps the collapsed tool call preview in a single summary row and toggles details open and closed", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SELECT cards.front_text, cards.back_text FROM cards ORDER BY updated_at DESC LIMIT 100\"}",
        output: "{\"rows\":[{\"front_text\":\"Question\",\"back_text\":\"Answer\"}]}",
      }],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const toolCall = chatPanel.getContainer().querySelector(".chat-tool-call");
    expect(toolCall).not.toBeNull();
    if (toolCall === null) {
      throw new Error("Expected tool call");
    }

    const summaryMain = toolCall.querySelector(".chat-tool-call-summary-main");
    expect(summaryMain).not.toBeNull();
    expect(summaryMain?.getAttribute("title")).toContain("SELECT cards.front_text");

    const summary = toolCall.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(toolCall.hasAttribute("open")).toBe(false);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(toolCall.hasAttribute("open")).toBe(true);
    expect(toolCall.querySelectorAll(".chat-tool-call-section")).toHaveLength(2);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(toolCall.hasAttribute("open")).toBe(false);
  });

  it("shows only the request section for a pending tool call without output", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "started",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: null,
      }],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const toolCall = chatPanel.getContainer().querySelector(".chat-tool-call");
    expect(toolCall).not.toBeNull();
    if (toolCall === null) {
      throw new Error("Expected tool call");
    }

    toolCall.setAttribute("open", "");
    expect(toolCall.querySelectorAll(".chat-tool-call-section")).toHaveLength(1);
    expect(toolCall.querySelector(".chat-tool-call-section-title")?.textContent).toBe("Request");
    expect(toolCall.querySelector(".chat-tool-call-output")).toBeNull();
  });

  it("copies the request and response text from expanded tool call sections", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: "{\"rows\":[]}",
      }],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const copyButtons = chatPanel.getContainer().querySelectorAll(".chat-tool-call-copy");
    expect(copyButtons).toHaveLength(2);

    await act(async () => {
      copyButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(chatPanel.getClipboardWriteTextMock()).toHaveBeenNthCalledWith(1, "{\"sql\":\"SHOW TABLES\"}");

    await act(async () => {
      copyButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(chatPanel.getClipboardWriteTextMock()).toHaveBeenNthCalledWith(2, "{\"rows\":[]}");
  });

  it("alerts when copying a tool call section fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    chatPanel.getClipboardWriteTextMock().mockRejectedValueOnce(new Error("Permission denied"));
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: "{\"rows\":[]}",
      }],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const copyButton = chatPanel.getContainer().querySelector(".chat-tool-call-copy");
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith("Failed to copy request. Permission denied");
    alertSpy.mockRestore();
  });
});
