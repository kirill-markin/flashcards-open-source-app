// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { persistLocalePreference } from "../../i18n/runtime";
import {
  ApiErrorMock,
  captureWebExceptionMock,
  createChatActiveRun,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  pressTextareaKey,
  queryChatComposerInput,
  queryChatSendButton,
  queryChatStopButton,
  readStoredDraftPendingAttachmentCount,
  readStoredDraftInputText,
  setTextareaSelection,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import { createVerifiedWorkspaceAppDataMock } from "./ChatPanelTestFixtures";
import {
  createChatDraftContent,
  loadChatDraftWorkspaceState,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
} from "../composer/chatDraftStorage";
import { storeChatSessionWarmStartSnapshot } from "../sessionController/warmStart";

const {
  clickAddAttachment,
  flushAsync,
  getContainer,
  hideChatPanel,
  renderChatPanel,
  renderChatPanelStrictMode,
  setMobileViewport,
  sendMessage,
  unmountChatPanel,
} = setupChatPanelTest();

function createChatSessionIdConflictError(): Error {
  return new ApiErrorMock(
    409,
    "Requested chat session id is already in use.",
    "CHAT_SESSION_ID_CONFLICT",
  );
}

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

  it("keeps a newer same-session draft when an older accepted send finishes", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation((requestBody) => new Promise((resolve) => {
      resolveStartRun = () => resolve({
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

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("old draft");
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("old draft");

    const newerDrafts = replaceChatDraftForSession(
      loadChatDraftWorkspaceState("workspace-1"),
      sessionId as string,
      createChatDraftContent("new draft", []),
    );
    storeChatDraftWorkspaceState("workspace-1", newerDrafts);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "flashcards-chat-drafts::workspace-1" }));
      await Promise.resolve();
    });

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("new draft");
    expect(queryChatComposerInput(getContainer())?.value).toBe("new draft");
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

  it("keeps the draft when a rejected send settles under StrictMode", async () => {
    startChatRunMock.mockRejectedValueOnce(new Error("Request failed with status 500"));

    await renderChatPanelStrictMode();
    await flushAsync();
    await flushAsync();

    await sendMessage("keep this strict-mode draft");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("keep this strict-mode draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("recovers from a stale session id conflict while provisioning the first remote session", async () => {
    createNewChatSessionMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Chat refresh failed.");

    await sendMessage("hello after stale session");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const recoveredSessionId = createNewChatSessionMock.mock.calls[2]?.[0];
    const textarea = queryChatComposerInput(getContainer());
    expect(typeof staleSessionId).toBe("string");
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
    expect(textarea?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("Requested chat session id is already in use.");
  });

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

  it("recovers from a stale session id conflict while starting a chat run", async () => {
    startChatRunMock.mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await sendMessage("hello after start conflict");
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
    const initialStartRunRequest = startChatRunMock.mock.calls[0]?.[0];
    const retryStartRunRequest = startChatRunMock.mock.calls[1]?.[0];
    expect(initialStartRunRequest).toEqual(expect.objectContaining({
      sessionId: staleSessionId,
    }));
    expect(retryStartRunRequest).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
    if (initialStartRunRequest === undefined || retryStartRunRequest === undefined) {
      throw new Error("Expected chat run requests");
    }
    expect({
      ...retryStartRunRequest,
      sessionId: initialStartRunRequest.sessionId,
    }).toEqual(initialStartRunRequest);
    expect(textarea?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("Requested chat session id is already in use.");
  });

  it("ignores a stale warm-start snapshot after session recovery", async () => {
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveHydrationSnapshot = (snapshot) => resolve(snapshot);
      expect(sessionId).toBe("session-stale");
    }));
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
        }),
        accepted: true,
      }))
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          activeRun: createChatActiveRun(),
        }),
        accepted: true,
      }));

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-stale", "workspace-1");

    await sendMessage("recover before stale snapshot resolves");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof recoveredSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(startChatRunMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));

    resolveHydrationSnapshot?.(createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Late stale snapshot" }],
          timestamp: 2,
          isError: false,
          isStopped: false,
          cursor: null,
          itemId: null,
        }],
      },
    }));
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("recover before stale snapshot resolves");
    expect(getContainer().textContent).not.toContain("Late stale snapshot");

    await sendMessage("second message after stale snapshot");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(3);
    expect(startChatRunMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
  });

  it("ignores a stale warm-start snapshot while recovery provisioning is pending", async () => {
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    let resolveRecoveredSession: (() => void) | null = null;
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveHydrationSnapshot = (snapshot) => resolve(snapshot);
      expect(sessionId).toBe("session-stale");
    }));
    createNewChatSessionMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveRecoveredSession = () => resolve({
        ok: true,
        sessionId,
        composerSuggestions: [],
        chatConfig: createChatSnapshot().chatConfig,
      });
    }));
    startChatRunMock.mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-stale", "workspace-1");

    await sendMessage("recover while provisioning waits");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof recoveredSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    resolveHydrationSnapshot?.(createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Snapshot resolved during recovery" }],
          timestamp: 2,
          isError: false,
          isStopped: false,
          cursor: null,
          itemId: null,
        }],
      },
    }));
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).not.toContain("Snapshot resolved during recovery");

    resolveRecoveredSession?.();
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(startChatRunMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
    expect(getContainer().textContent).toContain("recover while provisioning waits");
    expect(getContainer().textContent).not.toContain("Snapshot resolved during recovery");
  });

  it("ignores a stale warm-start snapshot failure after session recovery", async () => {
    let rejectHydrationSnapshot: ((error: Error) => void) | null = null;
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockImplementationOnce((sessionId: string) => new Promise((_, reject) => {
      rejectHydrationSnapshot = (error) => reject(error);
      expect(sessionId).toBe("session-stale");
    }));
    startChatRunMock.mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-stale", "workspace-1");

    await sendMessage("recover before stale snapshot fails");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof recoveredSessionId).toBe("string");

    rejectHydrationSnapshot?.(new Error("Late stale snapshot failed"));
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("recover before stale snapshot fails");
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("Chat refresh failed.");
    expect(captureWebExceptionMock).not.toHaveBeenCalled();
  });

  it("does not recover when hydration populates history before the session conflict returns", async () => {
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    let rejectStartRunWithConflict: (() => void) | null = null;
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveHydrationSnapshot = (snapshot) => resolve(snapshot);
      expect(sessionId).toBe("session-stale");
    }));
    startChatRunMock.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectStartRunWithConflict = () => reject(createChatSessionIdConflictError());
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-stale", "workspace-1");

    await sendMessage("do not recover after stale hydration applies");
    await flushAsync();
    await flushAsync();

    resolveHydrationSnapshot?.(createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Hydrated stale history" }],
          timestamp: 2,
          isError: false,
          isStopped: false,
          cursor: null,
          itemId: null,
        }],
      },
    }));
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Hydrated stale history");

    rejectStartRunWithConflict?.();
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(createNewChatSessionMock).not.toHaveBeenCalled();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("do not recover after stale hydration applies");
    expect(getContainer().textContent).toContain("Hydrated stale history");
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(getContainer().textContent).toContain("Requested chat session id is already in use.");
  });

  it("does not recover when hydration history and the session conflict settle before render", async () => {
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    let rejectStartRunWithConflict: (() => void) | null = null;
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveHydrationSnapshot = (snapshot) => resolve(snapshot);
      expect(sessionId).toBe("session-stale");
    }));
    startChatRunMock.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectStartRunWithConflict = () => reject(createChatSessionIdConflictError());
    }));

    await renderChatPanel();
    await flushAsync();

    await sendMessage("do not recover before hydration commit");
    await flushAsync();
    await flushAsync();

    resolveHydrationSnapshot?.(createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Same tick hydrated history" }],
          timestamp: 2,
          isError: false,
          isStopped: false,
          cursor: null,
          itemId: null,
        }],
      },
    }));
    rejectStartRunWithConflict?.();
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(createNewChatSessionMock).not.toHaveBeenCalled();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("do not recover before hydration commit");
    expect(getContainer().textContent).toContain("Same tick hydrated history");
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(getContainer().textContent).toContain("Requested chat session id is already in use.");
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

  it("does not recover more than once when the retry also hits a session id conflict", async () => {
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await sendMessage("retry conflict should stop");
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
    expect(textarea?.value).toBe("retry conflict should stop");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("retry conflict should stop");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(getContainer().textContent).toContain("Requested chat session id is already in use.");
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

  it("ignores a stale terminal reconcile after a newer run starts in the same session", async () => {
    let resolveTerminalReconcile: (() => void) | null = null;
    startChatRunMock
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          conversation: {
            updatedAt: 1,
            mainContentInvalidationVersion: 0,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "first terminal send" }],
                timestamp: 1,
                isError: false,
                isStopped: false,
                cursor: null,
                itemId: null,
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "Accepted terminal answer" }],
                timestamp: 2,
                isError: false,
                isStopped: false,
                cursor: null,
                itemId: null,
              },
            ],
          },
          activeRun: null,
        }),
        accepted: true,
      }))
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          activeRun: createChatActiveRun({ runId: "run-2" }),
        }),
        accepted: true,
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");
    getChatSnapshotMock.mockImplementationOnce((snapshotSessionId: string) => new Promise((resolve) => {
      expect(snapshotSessionId).toBe(sessionId);
      resolveTerminalReconcile = () => resolve(createChatSnapshot({
        sessionId: snapshotSessionId,
        conversationScopeId: snapshotSessionId,
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{ type: "text", text: "Late terminal reconcile" }],
            timestamp: 2,
            isError: false,
            isStopped: false,
            cursor: null,
            itemId: null,
          }],
        },
        activeRun: null,
      }));
    }));

    await sendMessage("first terminal send");
    await flushAsync();
    await flushAsync();
    expect(getContainer().textContent).toContain("Accepted terminal answer");

    await sendMessage("second active run");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(queryChatStopButton(getContainer())).not.toBeNull();

    resolveTerminalReconcile?.();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("second active run");
    expect(getContainer().textContent).toContain("Accepted terminal answer");
    expect(getContainer().textContent).not.toContain("Late terminal reconcile");
    expect(queryChatStopButton(getContainer())).not.toBeNull();
  });

  it("keeps a pending terminal reconcile when the next send is rejected before acceptance", async () => {
    let resolveTerminalReconcile: (() => void) | null = null;
    startChatRunMock
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          activeRun: null,
        }),
        accepted: true,
      }))
      .mockRejectedValueOnce(new ApiErrorMock(500, "Request failed with status 500", "INTERNAL_ERROR"));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");
    getChatSnapshotMock.mockImplementationOnce((snapshotSessionId: string) => new Promise((resolve) => {
      expect(snapshotSessionId).toBe(sessionId);
      resolveTerminalReconcile = () => resolve(createChatSnapshot({
        sessionId: snapshotSessionId,
        conversationScopeId: snapshotSessionId,
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{ type: "text", text: "Terminal reconcile applied" }],
            timestamp: 2,
            isError: false,
            isStopped: false,
            cursor: null,
            itemId: null,
          }],
        },
        activeRun: null,
      }));
    }));

    await sendMessage("first terminal send");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith(sessionId, "workspace-1");

    await sendMessage("second send rejected before acceptance");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(getContainer().textContent).not.toContain("Terminal reconcile applied");

    resolveTerminalReconcile?.();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Terminal reconcile applied");
    expect(queryChatComposerInput(getContainer())?.value).toBe("second send rejected before acceptance");
  });

  it("reconciles a terminal recovered send with the recovered session id", async () => {
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
        }),
        accepted: true,
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const snapshotCallsBeforeSend = getChatSnapshotMock.mock.calls.length;

    await sendMessage("terminal recovered send");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const lastSnapshotCall = getChatSnapshotMock.mock.calls[getChatSnapshotMock.mock.calls.length - 1];
    expect(typeof recoveredSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(getChatSnapshotMock.mock.calls.length).toBeGreaterThan(snapshotCallsBeforeSend);
    expect(lastSnapshotCall?.[0]).toBe(recoveredSessionId);
  });

  it("does not recover from a session id conflict when the local conversation is not empty", async () => {
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Existing response" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
          cursor: null,
          itemId: null,
        }],
      },
    }));
    startChatRunMock.mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Existing response");

    await sendMessage("keep this draft");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("keep this draft");
    expect(getContainer().textContent).toContain("Existing response");
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(getContainer().textContent).toContain("Requested chat session id is already in use.");
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

  it("restores the stored draft after an app remount while turn acceptance is still pending", async () => {
    startChatRunMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    const textareaBeforeRemount = queryChatComposerInput(getContainer());
    expect(textareaBeforeRemount?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterRemount = queryChatComposerInput(getContainer());
    expect(textareaAfterRemount?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
  });

  it("clears a first provisioned-session draft when the panel closes before turn acceptance", async () => {
    let resolveAcceptedRun: (() => void) | null = null;
    createNewChatSessionMock.mockRejectedValueOnce(new Error("Initial chat session failed"));
    startChatRunMock.mockImplementationOnce((requestBody) => new Promise((resolve) => {
      resolveAcceptedRun = () => resolve({
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

    expect(getContainer().textContent).toContain("Chat refresh failed.");

    await sendMessage("clear this first provisioned draft");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const provisionedSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof provisionedSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(readStoredDraftInputText("workspace-1", provisionedSessionId as string)).toBe("clear this first provisioned draft");

    await hideChatPanel();

    resolveAcceptedRun?.();
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", provisionedSessionId as string)).toBeNull();

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterAcceptedRun = queryChatComposerInput(getContainer());
    expect(textareaAfterAcceptedRun?.value).toBe("");
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
