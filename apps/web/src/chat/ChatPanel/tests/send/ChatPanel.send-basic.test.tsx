// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { persistLocalePreference } from "../../../../i18n/runtime";
import {
  createNewChatSessionMock,
  pressTextareaKey,
  queryChatComposerInput,
  queryChatSendButton,
  readStoredDraftInputText,
  setTextareaSelection,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
} from "../support/ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  setMobileViewport,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel send basic lifecycle", () => {
  it("shows a disabled send button until the draft has text or attachments", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    const sendButton = queryChatSendButton(getContainer());
    expect(textarea).not.toBeNull();
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);

    setTextareaValue(textarea as HTMLTextAreaElement, "hello");
    await flushAsync();

    expect(sendButton?.disabled).toBe(false);
  });

  it("returns focus to the composer after a successful send", async () => {
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea).not.toBeNull();

    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(textarea?.value).toBe("");
    expect(document.activeElement).toBe(textarea);
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBeNull();
  });

  it("includes an explicit sessionId in the first send request body", async () => {
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sessionId: createNewChatSessionMock.mock.calls[0]?.[0],
    }));
  });

  it("includes the current app locale in the first send request body", async () => {
    persistLocalePreference("ar");

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      uiLocale: "ar",
    }));
  });

  it("sends on desktop Enter", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea).not.toBeNull();

    setTextareaValue(textarea as HTMLTextAreaElement, "hello");
    await flushAsync();
    setTextareaSelection(textarea as HTMLTextAreaElement, 5, 5);

    pressTextareaKey(textarea as HTMLTextAreaElement, {
      key: "Enter",
      shiftKey: false,
      repeat: false,
    });
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("");
  });

  it("does not send on desktop Shift+Enter and keeps multiline draft input", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea).not.toBeNull();

    setTextareaValue(textarea as HTMLTextAreaElement, "hello");
    await flushAsync();
    setTextareaSelection(textarea as HTMLTextAreaElement, 5, 5);

    pressTextareaKey(textarea as HTMLTextAreaElement, {
      key: "Enter",
      shiftKey: true,
      repeat: false,
    });
    await flushAsync();

    expect(startChatRunMock).not.toHaveBeenCalled();
    expect(textarea?.value).toBe("hello\n");
  });

  it("does not send on mobile Enter and keeps multiline draft input", async () => {
    setMobileViewport(true);
    await renderChatPanel();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea).not.toBeNull();

    setTextareaValue(textarea as HTMLTextAreaElement, "hello");
    await flushAsync();
    setTextareaSelection(textarea as HTMLTextAreaElement, 5, 5);

    pressTextareaKey(textarea as HTMLTextAreaElement, {
      key: "Enter",
      shiftKey: false,
      repeat: false,
    });
    await flushAsync();

    expect(startChatRunMock).not.toHaveBeenCalled();
    expect(textarea?.value).toBe("hello\n");
  });
});
