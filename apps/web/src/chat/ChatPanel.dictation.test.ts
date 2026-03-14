// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  setupChatPanelTest,
  setTextareaSelection,
  setTextareaValue,
  transcribeChatAudioMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel dictation", () => {
  it("renders the microphone button immediately to the right of attach", async () => {
    await chatPanel.renderChatPanel();

    const controlsRight = chatPanel.getContainer().querySelector(".chat-controls-right");
    const controls = Array.from(controlsRight?.children ?? []).map((element) => element.className);
    expect(controls[0]).toContain("chat-attach-btn");
    expect(controls[1]).toContain("chat-mic-btn");
  });

  it("swaps the textarea for dictation UI and inserts the recognized transcript at the caret", async () => {
    await chatPanel.renderChatPanel();

    const mountedContainer = chatPanel.getContainer();
    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "hello world");
      setTextareaSelection(textarea as HTMLTextAreaElement, 5, 5);
    });

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mountedContainer.querySelector(".chat-dictation-surface-recording")).not.toBeNull();
    expect(mountedContainer.querySelector('textarea[name="chatMessage"]')).toBeNull();
    expect((mountedContainer.querySelector(".chat-send-btn") as HTMLButtonElement | null)?.disabled).toBe(true);

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();

    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const restoredTextarea = mountedContainer.querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(restoredTextarea).not.toBeNull();
    expect(restoredTextarea?.value).toBe("hello dictated text world");
    expect(restoredTextarea?.selectionStart).toBe("hello dictated text".length);
    expect(restoredTextarea?.selectionEnd).toBe("hello dictated text".length);
    expect(transcribeChatAudioMock).toHaveBeenCalledTimes(1);
  });

  it("replaces the selected textarea range with the recognized transcript", async () => {
    await chatPanel.renderChatPanel();

    const mountedContainer = chatPanel.getContainer();
    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "hello brave world");
      setTextareaSelection(textarea as HTMLTextAreaElement, 6, 11);
    });

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();

    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const restoredTextarea = mountedContainer.querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(restoredTextarea?.value).toBe("hello dictated text world");
    expect(restoredTextarea?.selectionStart).toBe("hello dictated text".length);
    expect(restoredTextarea?.selectionEnd).toBe("hello dictated text".length);
  });

  it("shows the transcription failure message when upload fails", async () => {
    transcribeChatAudioMock.mockRejectedValueOnce(new Error("There is a network problem. Fix it and try again."));
    await chatPanel.renderChatPanel();

    const mountedContainer = chatPanel.getContainer();
    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();

    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(chatPanel.getAlertMock()).toHaveBeenCalledWith("There is a network problem. Fix it and try again.");
  });
});
