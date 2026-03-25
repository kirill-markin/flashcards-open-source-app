import { describe, expect, it } from "vitest";
import {
  setTextareaSelection,
  setupChatPanelTest,
  transcribeChatAudioMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel dictation", () => {
  it("inserts dictated text into the draft before send", async () => {
    await chatPanel.renderChatPanel();

    const textarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    if (textarea === null) {
      throw new Error("Expected chat textarea");
    }

    textarea.focus();
    setTextareaSelection(textarea, 0, 0);

    const micButton = chatPanel.getContainer().querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();
    micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await chatPanel.flushAsync();

    const stopButton = chatPanel.getContainer().querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopButton).not.toBeNull();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await chatPanel.flushAsync();
    await chatPanel.flushAsync();

    const updatedTextarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(updatedTextarea).not.toBeNull();
    if (updatedTextarea === null) {
      throw new Error("Expected updated chat textarea");
    }

    expect(transcribeChatAudioMock).toHaveBeenCalledTimes(1);
    expect(updatedTextarea.value).toContain("dictated text");
  });
});
