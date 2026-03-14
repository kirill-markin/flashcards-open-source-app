// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createAbortableTimedStreamResponse,
  createDeferred,
  createTimedStreamResponse,
  setupChatPanelTest,
  setTextareaSelection,
  setTextareaValue,
  streamDeltaPayload,
  streamLocalChatMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel rendering", () => {
  it("renders a blank line between attachment markers and following text", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "user",
      content: [
        {
          type: "image",
          mediaType: "image/jpeg",
          base64Data: "abc",
        },
        {
          type: "text",
          text: "what do you see here?",
        },
      ],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const userMessage = chatPanel.getContainer().querySelector(".chat-msg-user");
    expect(userMessage).not.toBeNull();
    if (userMessage === null) {
      throw new Error("Expected user message");
    }

    expect(userMessage.querySelectorAll("br")).toHaveLength(2);
    expect(userMessage.textContent).toContain("[image attached]");
    expect(userMessage.textContent).toContain("what do you see here?");
  });

  it("preserves persisted assistant text whitespace", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{ type: "text", text: "\n\n   You're right to ask.\n\n\n\n**What I have:**   \n" }],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const assistantMessage = chatPanel.getContainer().querySelector(".chat-msg-assistant");
    expect(assistantMessage).not.toBeNull();
    expect(assistantMessage?.textContent).toBe("\n\n   You're right to ask.\n\n\n\n**What I have:**   \n");
  });

  it("preserves streamed assistant text whitespace before rendering the bubble", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 0, payload: streamDeltaPayload("\n\n   First paragraph") },
      { atMs: 10, payload: streamDeltaPayload("\n\n\n\nSecond paragraph   \n") },
    ], 20, 200));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("normalize assistant");

    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });

    const assistantMessages = chatPanel.getContainer().querySelectorAll(".chat-msg-assistant");
    expect(assistantMessages.length).toBeGreaterThan(0);
    const assistantMessage = assistantMessages[assistantMessages.length - 1];
    expect(assistantMessage?.textContent).toBe("\n\n   First paragraph\n\n\n\nSecond paragraph   \n");
  });

  it("shows the optimistic assistant status immediately after send while the first stream request is pending", async () => {
    const deferredResponse = createDeferred<Response>();
    streamLocalChatMock.mockImplementationOnce(() => deferredResponse.promise);

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("check cards");

    const mountedContainer = chatPanel.getContainer();
    expect(mountedContainer.textContent).toContain("Looking through your cards...");

    await act(async () => {
      deferredResponse.resolve(createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("Done") }], 1, 200));
      await Promise.resolve();
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    expect(mountedContainer.textContent).toContain("Done");
    expect(mountedContainer.textContent).not.toContain("Looking through your cards...");
  });

  it("preserves paragraph boundaries between consecutive persisted assistant text parts", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [
        { type: "text", text: "Точный план изменений:\n- не менять остальные теги\n\n" },
        { type: "text", text: "Подтверди, и я выполню объединение `DSA -> dsa`." },
      ],
      timestamp: 1,
      isError: false,
    }]));

    await chatPanel.renderChatPanel();

    const assistantMessage = chatPanel.getContainer().querySelector(".chat-msg-assistant");
    expect(assistantMessage).not.toBeNull();
    expect(assistantMessage?.children).toHaveLength(1);
    expect(assistantMessage?.textContent).toBe(
      "Точный план изменений:\n- не менять остальные теги\n\nПодтверди, и я выполню объединение `DSA -> dsa`.",
    );
  });

  it("preserves paragraph boundaries across streamed assistant deltas", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 0, payload: streamDeltaPayload("Точный план изменений:\n- не менять остальные теги\n\n") },
      { atMs: 10, payload: streamDeltaPayload("Подтверди, и я выполню объединение `DSA -> dsa`.") },
    ], 20, 200));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("merge tags");

    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });

    const assistantMessages = chatPanel.getContainer().querySelectorAll(".chat-msg-assistant");
    expect(assistantMessages.length).toBeGreaterThan(0);
    const assistantMessage = assistantMessages[assistantMessages.length - 1];
    expect(assistantMessage?.textContent).toBe(
      "Точный план изменений:\n- не менять остальные теги\n\nПодтверди, и я выполню объединение `DSA -> dsa`.",
    );
  });

  it("shows browser guidance when microphone permission is blocked", async () => {
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        }),
      },
    });
    Object.defineProperty(window.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({ state: "denied" })),
      },
    });

    await chatPanel.renderChatPanel();

    const micButton = chatPanel.getContainer().querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(chatPanel.getAlertMock()).toHaveBeenCalledWith(
      "Flashcards cannot use your microphone. Click the site controls in your browser bar and enable microphone access, then try again.",
    );
  });

  it("replaces send with stop while streaming and allows sending again after stop", async () => {
    streamLocalChatMock
      .mockImplementationOnce((_body: unknown, signal: AbortSignal) => Promise.resolve(
        createAbortableTimedStreamResponse(
          signal,
          [{ atMs: 50, payload: streamDeltaPayload("Partial response") }],
          5_000,
          200,
        ),
      ))
      .mockResolvedValueOnce(createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("Second response") }], 1, 200));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("first");

    const mountedContainer = chatPanel.getContainer();
    expect(mountedContainer.querySelector('.chat-send-btn[aria-label="Send message"]')).toBeNull();
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).not.toBeNull();
    expect((mountedContainer.querySelector(".chat-attach-btn") as HTMLButtonElement | null)?.disabled).toBe(false);
    expect((mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]') as HTMLButtonElement | null)?.disabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });

    expect(mountedContainer.textContent).toContain("Partial response");

    await chatPanel.stopStreaming();

    expect(streamLocalChatMock.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect((streamLocalChatMock.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).toBeNull();
    expect(mountedContainer.querySelector('.chat-send-btn[aria-label="Send message"]')).not.toBeNull();
    expect((mountedContainer.querySelector(".chat-attach-btn") as HTMLButtonElement | null)?.disabled).toBe(false);
    expect(mountedContainer.textContent).toContain("Partial response");

    await chatPanel.sendMessage("second");

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    expect(streamLocalChatMock).toHaveBeenCalledTimes(2);
    expect(mountedContainer.textContent).toContain("Second response");
  });

  it("aborts the active stream before clearing history when starting a new chat", async () => {
    streamLocalChatMock.mockImplementationOnce((_body: unknown, signal: AbortSignal) => Promise.resolve(
      createAbortableTimedStreamResponse(
        signal,
        [{ atMs: 50, payload: streamDeltaPayload("Partial response") }],
        5_000,
        200,
      ),
    ));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("first");

    const mountedContainer = chatPanel.getContainer();
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });

    const newButton = [...mountedContainer.querySelectorAll("button")].find((button) => button.textContent === "New");
    expect(newButton).not.toBeUndefined();

    await act(async () => {
      newButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(streamLocalChatMock.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect((streamLocalChatMock.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    expect(mountedContainer.textContent).not.toContain("Partial response");
    expect(mountedContainer.querySelectorAll(".chat-msg")).toHaveLength(0);
  });

  it("lets the user keep building the next draft while the assistant is streaming", async () => {
    streamLocalChatMock.mockImplementationOnce((_body: unknown, signal: AbortSignal) => Promise.resolve(
      createAbortableTimedStreamResponse(
        signal,
        [{ atMs: 50, payload: streamDeltaPayload("Partial response") }],
        5_000,
        200,
      ),
    ));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("first");

    const mountedContainer = chatPanel.getContainer();
    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "next steps");
      setTextareaSelection(textarea as HTMLTextAreaElement, 4, 4);
    });

    const attachButton = mountedContainer.querySelector(".chat-attach-btn");
    expect((attachButton as HTMLButtonElement | null)?.disabled).toBe(false);
    await act(async () => {
      attachButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect((micButton as HTMLButtonElement | null)?.disabled).toBe(false);
    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mountedContainer.querySelector(".chat-dictation-surface-recording")).not.toBeNull();
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).not.toBeNull();

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();
    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const restoredTextarea = mountedContainer.querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(restoredTextarea?.value).toBe("next dictated text steps");
    expect(restoredTextarea?.selectionStart).toBe("next dictated text".length);
    expect(restoredTextarea?.selectionEnd).toBe("next dictated text".length);
    expect(mountedContainer.textContent).toContain("attached.txt");
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).not.toBeNull();
  });
});
