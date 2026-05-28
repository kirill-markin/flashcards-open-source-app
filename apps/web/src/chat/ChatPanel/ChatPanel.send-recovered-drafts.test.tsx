// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ApiErrorMock,
  captureWebExceptionMock,
  createChatActiveRun,
  createChatSessionIdConflictError,
  createChatSnapshot,
  createNewChatSessionMock,
  queryChatComposerInput,
  queryChatSendButton,
  readStoredDraftPendingAttachmentCount,
  readStoredDraftInputText,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
} from "./ChatPanelTestSupport";
import {
  createChatDraftContent,
  loadChatDraftWorkspaceState,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
} from "../composer/chatDraftStorage";

const {
  clickAddAttachment,
  flushAsync,
  getContainer,
  hideChatPanel,
  renderChatPanel,
  sendMessage,
  unmountChatPanel,
} = setupChatPanelTest();

describe("ChatPanel send recovered drafts", () => {
  it("keeps the draft on the recovered session when send fails after provisioning recovery", async () => {
    createNewChatSessionMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(createChatSessionIdConflictError());
    startChatRunMock.mockRejectedValueOnce(new Error("Request failed with status 500"));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Chat refresh failed.");

    await sendMessage("keep this draft after provisioning recovery");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[2]?.[0];
    const textarea = queryChatComposerInput(getContainer());
    expect(typeof recoveredSessionId).toBe("string");
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(3);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
    expect(textarea?.value).toBe("keep this draft after provisioning recovery");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("keep this draft after provisioning recovery");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("keeps the original draft visible when the retry after session recovery fails", async () => {
    const retryError = new ApiErrorMock(500, "Request failed with status 500", "INTERNAL_ERROR");
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(retryError);

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await clickAddAttachment();
    await flushAsync();

    await sendMessage("keep this draft after retry failure");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const textarea = queryChatComposerInput(getContainer());
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(textarea?.value).toBe("keep this draft after retry failure");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("keep this draft after retry failure");
    expect(readStoredDraftPendingAttachmentCount("workspace-1", staleSessionId as string)).toBe(0);
    expect(readStoredDraftPendingAttachmentCount("workspace-1", recoveredSessionId as string)).toBe(1);
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(captureWebExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "chat_run_request_failed",
      error: retryError,
      details: {
        operation: "chat_start_run_failed",
        sessionId: recoveredSessionId,
        workspaceId: "workspace-1",
      },
    }));
  });

  it("does not overwrite a newer recovered-session draft when recovery retry fails", async () => {
    let rejectRecoveredRetry: (() => void) | null = null;
    const retryError = new ApiErrorMock(500, "Request failed with status 500", "INTERNAL_ERROR");
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectRecoveredRetry = () => reject(retryError);
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("old recovered draft");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof recoveredSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(2);

    const newerRecoveredDrafts = replaceChatDraftForSession(
      loadChatDraftWorkspaceState("workspace-1"),
      recoveredSessionId as string,
      createChatDraftContent("new recovered draft", []),
    );
    storeChatDraftWorkspaceState("workspace-1", newerRecoveredDrafts);

    rejectRecoveredRetry?.();
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("new recovered draft");
  });

  it("does not clear a newer same-content source-session draft when moving to a recovered session", async () => {
    let resolveRecoveredSession: (() => void) | null = null;
    const retryError = new ApiErrorMock(500, "Request failed with status 500", "INTERNAL_ERROR");
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(retryError);

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");
    createNewChatSessionMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveRecoveredSession = () => resolve({
        ok: true,
        sessionId,
        composerSuggestions: [],
        chatConfig: createChatSnapshot().chatConfig,
      });
    }));

    await sendMessage("pending source draft");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof recoveredSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    const newerSourceDrafts = replaceChatDraftForSession(
      loadChatDraftWorkspaceState("workspace-1"),
      staleSessionId as string,
      createChatDraftContent("pending source draft", []),
    );
    storeChatDraftWorkspaceState("workspace-1", newerSourceDrafts);
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBe("pending source draft");

    resolveRecoveredSession?.();
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBe("pending source draft");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("pending source draft");
  });

  it("restores the recovered-session draft after an app remount while the retry is still pending", async () => {
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await sendMessage("keep this draft during recovered retry");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const textareaBeforeRemount = queryChatComposerInput(getContainer());
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(textareaBeforeRemount?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("keep this draft during recovered retry");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterRemount = queryChatComposerInput(getContainer());
    expect(textareaAfterRemount?.value).toBe("keep this draft during recovered retry");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("keep this draft during recovered retry");
  });

  it("keeps the recovered-session draft when the panel closes before recovery finishes", async () => {
    let resolveRecoveredSession: (() => void) | null = null;
    let rejectRecoveredRetry: (() => void) | null = null;
    const retryError = new ApiErrorMock(500, "Request failed with status 500", "INTERNAL_ERROR");
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectRecoveredRetry = () => reject(retryError);
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");
    createNewChatSessionMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveRecoveredSession = () => resolve({
        ok: true,
        sessionId,
        composerSuggestions: [],
        chatConfig: createChatSnapshot().chatConfig,
      });
    }));

    await sendMessage("keep this draft after closing panel");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    await hideChatPanel();
    resolveRecoveredSession?.();
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(startChatRunMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const composerStateAfterReopen = getContainer().querySelector('[data-testid="chat-composer-state"]');
    const textareaAfterReopen = queryChatComposerInput(getContainer());
    const sendButtonAfterReopen = queryChatSendButton(getContainer());
    expect(composerStateAfterReopen?.getAttribute("data-send-phase")).toBe("startingRun");
    expect(textareaAfterReopen?.value).toBe("keep this draft after closing panel");
    expect(sendButtonAfterReopen?.disabled).toBe(true);
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("keep this draft after closing panel");

    rejectRecoveredRetry?.();
    await flushAsync();
    await flushAsync();

    const composerStateAfterRetryFailure = getContainer().querySelector('[data-testid="chat-composer-state"]');
    const sendButtonAfterRetryFailure = queryChatSendButton(getContainer());
    expect(composerStateAfterRetryFailure?.getAttribute("data-send-phase")).toBe("idle");
    expect(sendButtonAfterRetryFailure?.disabled).toBe(false);
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("keep this draft after closing panel");
  });

  it("clears the recovered-session draft when the retry succeeds after an app remount", async () => {
    let resolveRecoveredRetry: (() => void) | null = null;
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce((requestBody) => new Promise((resolve) => {
        resolveRecoveredRetry = () => resolve({
          ...createChatSnapshot({
            sessionId: requestBody.sessionId,
            conversationScopeId: requestBody.sessionId,
            activeRun: createChatActiveRun(),
          }),
          accepted: true,
        });
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await sendMessage("clear this draft after accepted retry");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("clear this draft after accepted retry");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaBeforeAcceptedRetry = queryChatComposerInput(getContainer());
    expect(textareaBeforeAcceptedRetry?.value).toBe("clear this draft after accepted retry");

    resolveRecoveredRetry?.();
    await flushAsync();
    await flushAsync();

    const textareaAfterAcceptedRetry = queryChatComposerInput(getContainer());
    expect(textareaAfterAcceptedRetry?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBeNull();
  });

  it("keeps an edited recovered-session draft when the old retry succeeds after an app remount", async () => {
    let resolveRecoveredRetry: (() => void) | null = null;
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce((requestBody) => new Promise((resolve) => {
        resolveRecoveredRetry = () => resolve({
          ...createChatSnapshot({
            sessionId: requestBody.sessionId,
            conversationScopeId: requestBody.sessionId,
            activeRun: createChatActiveRun(),
          }),
          accepted: true,
        });
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("old pending draft");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof recoveredSessionId).toBe("string");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const editedTextarea = queryChatComposerInput(getContainer());
    expect(editedTextarea?.value).toBe("old pending draft");
    setTextareaValue(editedTextarea as HTMLTextAreaElement, "new unsent draft");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("new unsent draft");

    resolveRecoveredRetry?.();
    await flushAsync();
    await flushAsync();

    const textareaAfterAcceptedRetry = queryChatComposerInput(getContainer());
    expect(textareaAfterAcceptedRetry?.value).toBe("new unsent draft");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("new unsent draft");
  });

  it("keeps a retyped same-content recovered-session draft when the old retry succeeds after an app remount", async () => {
    let resolveRecoveredRetry: (() => void) | null = null;
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce((requestBody) => new Promise((resolve) => {
        resolveRecoveredRetry = () => resolve({
          ...createChatSnapshot({
            sessionId: requestBody.sessionId,
            conversationScopeId: requestBody.sessionId,
            activeRun: createChatActiveRun(),
          }),
          accepted: true,
        });
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("same pending draft");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof recoveredSessionId).toBe("string");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const retypedTextarea = queryChatComposerInput(getContainer());
    expect(retypedTextarea?.value).toBe("same pending draft");
    vi.advanceTimersByTime(1);
    setTextareaValue(retypedTextarea as HTMLTextAreaElement, "same pending draft ");
    vi.advanceTimersByTime(1);
    setTextareaValue(retypedTextarea as HTMLTextAreaElement, "same pending draft");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("same pending draft");

    resolveRecoveredRetry?.();
    await flushAsync();
    await flushAsync();

    const textareaAfterAcceptedRetry = queryChatComposerInput(getContainer());
    expect(textareaAfterAcceptedRetry?.value).toBe("same pending draft");
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("same pending draft");
  });
});
