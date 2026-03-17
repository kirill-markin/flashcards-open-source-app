// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  configureMessagesScroller,
  countSmoothCalls,
  createTimedStreamResponse,
  readScrollBehavior,
  setupChatPanelTest,
  streamDeltaPayload,
  streamAIChatMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel autoscroll", () => {
  it("snaps to bottom without smooth animation after loading persisted history", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{ type: "text", text: "Persisted answer" }],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const behaviors = chatPanel.getScrollToMock().mock.calls.map((call) => readScrollBehavior(call));
    expect(behaviors).toContain("auto");
    expect(behaviors).not.toContain("smooth");
  });

  it("batches streaming autoscroll to one smooth scroll every 2 seconds", async () => {
    streamAIChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 100, payload: streamDeltaPayload("A") },
      { atMs: 300, payload: streamDeltaPayload("B") },
      { atMs: 700, payload: streamDeltaPayload("C") },
    ], 2_600, 200));

    await chatPanel.renderChatPanel();

    const messagesElement = chatPanel.getContainer().querySelector(".chat-messages");
    expect(messagesElement).not.toBeNull();
    configureMessagesScroller(messagesElement as HTMLDivElement);
    chatPanel.getScrollToMock().mockClear();

    await chatPanel.sendMessage("hello");

    await act(async () => {
      vi.advanceTimersByTime(1_999);
      await Promise.resolve();
    });
    expect(countSmoothCalls(chatPanel.getScrollToMock().mock.calls)).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(countSmoothCalls(chatPanel.getScrollToMock().mock.calls)).toBe(1);
  });

  it("disables autoscroll when user scrolls up and keeps it off during streaming", async () => {
    streamAIChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 100, payload: streamDeltaPayload("A") },
      { atMs: 500, payload: streamDeltaPayload("B") },
      { atMs: 900, payload: streamDeltaPayload("C") },
    ], 5_000, 200));

    await chatPanel.renderChatPanel();

    const messagesElement = chatPanel.getContainer().querySelector(".chat-messages");
    expect(messagesElement).not.toBeNull();
    const chatMessages = messagesElement as HTMLDivElement;
    configureMessagesScroller(chatMessages);
    chatPanel.getScrollToMock().mockClear();

    await chatPanel.sendMessage("keep reading");

    await act(async () => {
      vi.advanceTimersByTime(300);
      chatMessages.scrollTop = 250;
      chatMessages.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1_900);
      await Promise.resolve();
    });

    expect(countSmoothCalls(chatPanel.getScrollToMock().mock.calls)).toBe(0);
  });

  it("re-enables autoscroll after returning to bottom and catches up on the next tick", async () => {
    streamAIChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 100, payload: streamDeltaPayload("A") },
      { atMs: 500, payload: streamDeltaPayload("B") },
      { atMs: 900, payload: streamDeltaPayload("C") },
    ], 6_000, 200));

    await chatPanel.renderChatPanel();

    const messagesElement = chatPanel.getContainer().querySelector(".chat-messages");
    expect(messagesElement).not.toBeNull();
    const chatMessages = messagesElement as HTMLDivElement;
    configureMessagesScroller(chatMessages);
    chatPanel.getScrollToMock().mockClear();

    await chatPanel.sendMessage("resume autoscroll");

    await act(async () => {
      vi.advanceTimersByTime(300);
      chatMessages.scrollTop = 250;
      chatMessages.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1_900);
      await Promise.resolve();
    });
    expect(countSmoothCalls(chatPanel.getScrollToMock().mock.calls)).toBe(0);

    await act(async () => {
      chatMessages.scrollTop = 600;
      chatMessages.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    expect(countSmoothCalls(chatPanel.getScrollToMock().mock.calls)).toBe(1);
  });
});
