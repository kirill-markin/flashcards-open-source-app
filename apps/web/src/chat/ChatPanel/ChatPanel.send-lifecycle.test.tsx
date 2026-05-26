// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { persistLocalePreference } from "../../i18n/runtime";
import {
  ApiErrorMock,
  createChatActiveRun,
  createChatSnapshot,
  createNewChatSessionMock,
  pressTextareaKey,
  queryChatComposerInput,
  queryChatSendButton,
  readStoredDraftInputText,
  setTextareaSelection,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import { createVerifiedWorkspaceAppDataMock } from "./ChatPanelTestFixtures";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  setMobileViewport,
  sendMessage,
  unmountChatPanel,
} = setupChatPanelTest();

describe("ChatPanel send lifecycle", () => {
  it("shows a disabled send button until the draft has text or attachments", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    const sendButton = queryChatSendButton(getContainer());
    expect(textarea).not.toBeNull();
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);

    await setTextareaValue(textarea as HTMLTextAreaElement, "hello");
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

    await setTextareaValue(textarea as HTMLTextAreaElement, "hello");
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

    await setTextareaValue(textarea as HTMLTextAreaElement, "hello");
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

    await setTextareaValue(textarea as HTMLTextAreaElement, "hello");
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

  it("sends only one POST /chat while async preflight is in progress", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({ activeRun: createChatActiveRun() }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await sendMessage("hello");
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("clears the composer immediately while turn acceptance is still in flight", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({ activeRun: createChatActiveRun() }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("");

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("keeps starting a new chat enabled while turn acceptance is still in flight", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({ activeRun: createChatActiveRun() }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    const newButton = [...getContainer().querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "New");
    expect(newButton).not.toBeUndefined();
    expect((newButton as HTMLButtonElement).disabled).toBe(false);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("keeps the stored draft through a runSync preflight failure", async () => {
    let rejectRunSync: ((error: Error) => void) | null = null;
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(() => new Promise((_, reject) => {
        rejectRunSync = (error) => reject(error);
      })),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    const textareaBeforeFailure = queryChatComposerInput(getContainer());
    expect(textareaBeforeFailure?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    rejectRunSync?.(new Error("sync failed"));
    await flushAsync();
    await flushAsync();

    const textareaAfterFailure = queryChatComposerInput(getContainer());
    expect(textareaAfterFailure?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
  });

  it("keeps the draft when startRun fails before the server accepts the turn", async () => {
    let rejectStartRun: ((error: Error) => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((_, reject) => {
      rejectStartRun = (error) => reject(error);
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    expect((queryChatComposerInput(getContainer()))?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    rejectStartRun?.(new Error("Request failed with status 500"));
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

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

  it("restores the stored draft after a refresh while turn acceptance is still pending", async () => {
    startChatRunMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    const textareaBeforeRefresh = queryChatComposerInput(getContainer());
    expect(textareaBeforeRefresh?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterRefresh = queryChatComposerInput(getContainer());
    expect(textareaAfterRefresh?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
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
