// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ApiErrorMock,
  createNewChatSessionMock,
  queryChatComposerInput,
  readStoredDraftInputText,
  setupChatPanelTest,
  startChatRunMock,
} from "./support/ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel send error handling", () => {
  it("keeps the draft and shows clean copy when the backend rejects an oversized request", async () => {
    startChatRunMock.mockRejectedValue(new ApiErrorMock(
      413,
      "AI chat request is too large.",
      "CHAT_REQUEST_TOO_LARGE",
    ));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this oversized draft");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("keep this oversized draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this oversized draft");
    expect(getContainer().textContent).toContain("Message is too large.");
    expect(getContainer().textContent).not.toContain("AI chat request is too large.");
  });

  it("keeps the draft and shows clean copy when the backend rejects an unsupported attachment", async () => {
    startChatRunMock.mockRejectedValue(new ApiErrorMock(
      400,
      "This file type is not supported for AI chat.",
      "CHAT_ATTACHMENT_UNSUPPORTED_TYPE",
    ));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this attachment draft");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("keep this attachment draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this attachment draft");
    expect(getContainer().textContent).toContain("This file type is not supported for AI chat.");
    expect(getContainer().textContent).not.toContain("Chat request failed.");
  });

  it("treats active-run conflicts as a non-destructive composer notice", async () => {
    startChatRunMock.mockRejectedValue(new ApiErrorMock(
      409,
      "Chat session already has an active response",
      "CHAT_ACTIVE_RUN_IN_PROGRESS",
    ));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("second turn");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("second turn");
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("A response is already in progress.");
  });
});
