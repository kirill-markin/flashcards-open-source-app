// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { persistLocalePreference } from "../i18n/runtime";
import {
  ApiErrorMock,
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createDropEvent,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  prepareAttachmentMock,
  pressTextareaKey,
  setTextareaSelection,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  stopChatRunMock,
  transcribeChatAudioMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import { getChatComposerCapabilities } from "./chatComposerState";
import {
  createUnverifiedWorkspaceAppDataMock,
  createVerifiedWorkspaceAppDataMock,
} from "./ChatPanelTestFixtures";
import {
  loadChatDraftWorkspaceState,
  readChatDraftForSession,
} from "./chatDraftStorage";
import { storeChatSessionWarmStartSnapshot } from "./sessionController/warmStart";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  setMobileViewport,
  sendMessage,
  clickStop,
  clickMicrophone,
  unmountChatPanel,
} = setupChatPanelTest();

function readStoredDraftInputText(sessionId: string): string | null {
  return readChatDraftForSession(loadChatDraftWorkspaceState("workspace-1"), sessionId)?.inputText ?? null;
}

function readStoredDraftPendingAttachmentCount(sessionId: string): number {
  return readChatDraftForSession(loadChatDraftWorkspaceState("workspace-1"), sessionId)?.pendingAttachments.length ?? 0;
}

function createChatConfigWithAttachmentsEnabled(
  attachmentsEnabled: boolean,
): ReturnType<typeof createChatSnapshot>["chatConfig"] {
  const chatConfig = createChatSnapshot().chatConfig;
  return {
    ...chatConfig,
    features: {
      ...chatConfig.features,
      attachmentsEnabled,
    },
  };
}

function createChatPanelDragEnterEvent(file: File): DragEvent {
  const dragEvent = new Event("dragenter", { bubbles: true, cancelable: true }) as DragEvent;
  const dataTransfer: { files: ReadonlyArray<File>; dropEffect: DataTransfer["dropEffect"] } = {
    files: [file],
    dropEffect: "none",
  };
  Object.defineProperty(dragEvent, "dataTransfer", {
    value: dataTransfer,
  });
  return dragEvent;
}

async function dispatchChatPanelDragEvent(dragEvent: DragEvent): Promise<void> {
  const chatPanel = getContainer().querySelector('[data-testid="chat-panel"]') as HTMLDivElement | null;
  expect(chatPanel).not.toBeNull();

  await act(async () => {
    chatPanel?.dispatchEvent(dragEvent);
    await Promise.resolve();
  });
}

describe("ChatPanel send lifecycle", () => {
  it("shows loading UI instead of empty suggestions while the initial chat history is unresolved", async () => {
    getChatSnapshotMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();

    expect(getContainer().textContent).toContain("Loading AI chat");
    expect(getContainer().textContent).not.toContain("Start a new AI chat");
  });

  it("preserves the visible transcript while the session is revalidating without showing a restore notice", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Existing response" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      },
    }));

    await renderChatPanel();
    await flushAsync();

    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Existing response" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      },
    }), false);

    useAppDataMock.mockReturnValue(createUnverifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getContainer().textContent).toContain("Existing response");
    expect(getContainer().textContent).not.toContain("Restoring session...");
    expect(getContainer().textContent).not.toContain("Start a new AI chat");
  });

  it("revalidates the persisted warm-start session id during initial hydration", async () => {
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-local-fresh",
      conversationScopeId: "session-local-fresh",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-local-fresh",
      conversationScopeId: "session-local-fresh",
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-local-fresh", "workspace-1");
  });

  it("opens a stale warm-start session as a fresh local chat without loading the stale session", async () => {
    const staleTimestamp = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(new Date(staleTimestamp + (6 * 60 * 60 * 1000) + 1_000));
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: staleTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Old question" }],
            timestamp: staleTimestamp,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Old answer" }],
            timestamp: staleTimestamp + 1,
            isError: false,
            isStopped: false,
          },
        ],
      },
    }), false);

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).not.toHaveBeenCalled();
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(createNewChatSessionMock.mock.calls[0]?.[0]).not.toBe("session-stale");
    expect(getContainer().textContent).not.toContain("Old question");
    expect(getContainer().textContent).not.toContain("Old answer");
  });

  it("does not stale-roll over an assistant-only warm-start transcript", async () => {
    const staleTimestamp = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(new Date(staleTimestamp + (6 * 60 * 60 * 1000) + 1_000));
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-assistant-only",
      conversationScopeId: "session-assistant-only",
      conversation: {
        updatedAt: staleTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Assistant only" }],
          timestamp: staleTimestamp,
          isError: false,
          isStopped: false,
        }],
      },
    }), false);
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-assistant-only",
      conversationScopeId: "session-assistant-only",
      conversation: {
        updatedAt: staleTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Assistant only" }],
          timestamp: staleTimestamp,
          isError: false,
          isStopped: false,
        }],
      },
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-assistant-only", "workspace-1");
    expect(createNewChatSessionMock).not.toHaveBeenCalled();
  });

  it("provisions a remote session before the first bootstrap snapshot when no warm-start session id exists", async () => {
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock.mock.calls[0]?.[0]).toBe(createNewChatSessionMock.mock.calls[0]?.[0]);
    expect(createNewChatSessionMock.mock.invocationCallOrder[0]).toBeLessThan(getChatSnapshotMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });

  it("shows a disabled send button until the draft has text or attachments", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    const sendButton = getContainer().querySelector('.chat-send-btn[aria-label="Send message"]') as HTMLButtonElement | null;
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

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(textarea?.value).toBe("");
    expect(document.activeElement).toBe(textarea);
    expect(readStoredDraftInputText(sessionId as string)).toBeNull();
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

  it("includes an explicit sessionId in the first dictation upload", async () => {
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickMicrophone();
    await flushAsync();

    await clickMicrophone();
    await flushAsync();
    await flushAsync();

    expect(transcribeChatAudioMock).toHaveBeenCalledTimes(1);
    expect(transcribeChatAudioMock.mock.calls[0]?.[2]).toBe(createNewChatSessionMock.mock.calls[0]?.[0]);
  });

  it("sends on desktop Enter", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
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

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
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

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
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

  it("does not fetch remote chat history until the browser session is verified", async () => {
    useAppDataMock.mockReturnValue(createUnverifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).toContain("Loading AI chat");
  });

  it("does not restart initial hydration when switching between sidebar and fullscreen chat surfaces", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Existing response" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      },
    }));

    await renderChatPanel("sidebar");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);

    await renderChatPanel("fullscreen");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getContainer().textContent).toContain("Existing response");
  });

  it("does not reuse the previous workspace session id when hydrating a new workspace", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-workspace-1",
        conversationScopeId: "session-workspace-1",
      }))
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-workspace-2",
        conversationScopeId: "session-workspace-2",
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    useAppDataMock.mockReturnValue({
      ...createVerifiedWorkspaceAppDataMock({
        refreshLocalData: vi.fn(async (): Promise<void> => undefined),
        runSync: vi.fn(async (): Promise<void> => undefined),
        setErrorMessage: vi.fn(),
      }),
      activeWorkspace: {
        workspaceId: "workspace-2",
        name: "Secondary",
        createdAt: "2026-03-11T00:00:00.000Z",
        isSelected: true,
      },
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getChatSnapshotMock.mock.calls[1]?.[0]).toBe(createNewChatSessionMock.mock.calls[1]?.[0]);
    expect(getChatSnapshotMock.mock.calls[1]?.[0]).not.toBe("session-workspace-1");
  });

  it("uses the persisted chat snapshot as the first paint while refresh is pending", async () => {
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Warm start response" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      },
    }), false);
    getChatSnapshotMock.mockImplementation(() => new Promise(() => undefined));
    useAppDataMock.mockReturnValue(createUnverifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();

    expect(getContainer().textContent).toContain("Warm start response");
    expect(getContainer().textContent).not.toContain("Loading AI chat");
    expect(getContainer().textContent).not.toContain("Start a new AI chat");
  });

  it("does not restart initial hydration for the same workspace after a failed snapshot refresh", async () => {
    getChatSnapshotMock.mockRejectedValue(new Error("Request failed with status 500"));

    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat refresh failed.");
    expect(getContainer().textContent).not.toContain("Loading AI chat");
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

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("");

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("shows stop while the assistant run is active and returns to send afterward", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValue(createChatSnapshot({
        sessionId: "session-1",
        activeRun: createChatActiveRun(),
      }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    const stopButton = getContainer().querySelector('.chat-stop-btn[aria-label="Stop response"]') as HTMLButtonElement | null;
    const sendButton = getContainer().querySelector('.chat-send-btn[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(false);
    expect(sendButton).toBeNull();
  });

  it("keeps draft preparation controls enabled while an assistant run is active", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      activeRun: createChatActiveRun(),
    }));
    prepareAttachmentMock.mockResolvedValue({
      type: "binary",
      fileName: "next-draft.txt",
      mediaType: "text/plain",
      base64Data: "bmV4dA==",
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const composerState = getContainer().querySelector('[data-testid="chat-composer-state"]') as HTMLDivElement | null;
    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    const attachButton = getContainer().querySelector('.chat-attach-btn[aria-label="Add attachment"]') as HTMLButtonElement | null;
    const microphoneButton = getContainer().querySelector(".chat-mic-btn") as HTMLButtonElement | null;
    const stopButton = getContainer().querySelector('.chat-stop-btn[aria-label="Stop response"]') as HTMLButtonElement | null;
    const sendButton = getContainer().querySelector('.chat-send-btn[aria-label="Send message"]') as HTMLButtonElement | null;

    expect(composerState?.getAttribute("data-composer-action")).toBe("stop");
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(false);
    expect(microphoneButton).not.toBeNull();
    expect(microphoneButton?.disabled).toBe(false);
    expect(stopButton).not.toBeNull();
    expect(sendButton).toBeNull();

    await setTextareaValue(textarea as HTMLTextAreaElement, "next draft");
    await flushAsync();
    await dispatchChatPanelDragEvent(createDropEvent(new File(["next"], "next-draft.txt", { type: "text/plain" })));
    await flushAsync();

    expect(prepareAttachmentMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("next draft");
    expect(getContainer().textContent).toContain("next-draft.txt");
  });

  it("locks draft preparation controls while an active assistant run is stopping", async () => {
    let resolveStopRun: (() => void) | null = null;
    stopChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStopRun = () => resolve({
        sessionId: "session-1",
        stopped: true,
        stillRunning: false,
      });
    }));
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      activeRun: createChatActiveRun(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();

    const composerState = getContainer().querySelector('[data-testid="chat-composer-state"]') as HTMLDivElement | null;
    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    const attachButton = getContainer().querySelector('.chat-attach-btn[aria-label="Add attachment"]') as HTMLButtonElement | null;
    const microphoneButton = getContainer().querySelector(".chat-mic-btn") as HTMLButtonElement | null;
    const stopButton = getContainer().querySelector('.chat-stop-btn[aria-label="Stop response"]') as HTMLButtonElement | null;
    const getUserMediaMock = navigator.mediaDevices?.getUserMedia as ReturnType<typeof vi.fn>;

    expect(composerState?.getAttribute("data-composer-state")).toBe("stopping");
    expect(composerState?.getAttribute("data-stopping")).toBe("true");
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(true);
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(true);
    expect(microphoneButton).not.toBeNull();
    expect(microphoneButton?.disabled).toBe(true);
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(true);

    await clickMicrophone();
    await flushAsync();

    expect(getUserMediaMock).not.toHaveBeenCalled();

    const file = new File(["stopping"], "stopping.txt", { type: "text/plain" });
    await dispatchChatPanelDragEvent(createChatPanelDragEnterEvent(file));

    expect(getContainer().querySelector(".chat-drop-overlay")).toBeNull();

    await dispatchChatPanelDragEvent(createDropEvent(file));
    await flushAsync();

    expect(prepareAttachmentMock).not.toHaveBeenCalled();

    resolveStopRun?.();
    await flushAsync();
  });

  it("keeps active recording stoppable when dictation becomes disabled", () => {
    const capabilities = getChatComposerCapabilities({
      areAttachmentsEnabled: true,
      dictationState: "recording",
      isChatActionLocked: false,
      isChatConversationReadyForAttachments: true,
      isDictationEnabled: false,
      isStopping: false,
      sendPhase: "idle",
    });

    expect(capabilities.canStartDictation).toBe(false);
    expect(capabilities.isDictationButtonDisabled).toBe(false);
  });

  it("ignores dropped files when attachments are disabled by chat config", async () => {
    const chatConfig = createChatConfigWithAttachmentsEnabled(false);
    createNewChatSessionMock.mockImplementation(async (sessionId: string) => ({
      ok: true,
      sessionId,
      composerSuggestions: [],
      chatConfig,
    }));
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      chatConfig,
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const attachButton = getContainer().querySelector('.chat-attach-btn[aria-label="Add attachment"]') as HTMLButtonElement | null;
    const file = new File(["disabled"], "disabled.txt", { type: "text/plain" });
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(true);

    await dispatchChatPanelDragEvent(createChatPanelDragEnterEvent(file));

    expect(getContainer().querySelector(".chat-drop-overlay")).toBeNull();

    await dispatchChatPanelDragEvent(createDropEvent(file));
    await flushAsync();

    expect(prepareAttachmentMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).not.toContain("disabled.txt");
  });

  it("ignores dropped files while a send is being prepared", async () => {
    const runSyncMock = vi.fn(() => new Promise<void>(() => undefined));
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("hello");
    await flushAsync();

    const composerState = getContainer().querySelector('[data-testid="chat-composer-state"]') as HTMLDivElement | null;
    const attachButton = getContainer().querySelector('.chat-attach-btn[aria-label="Add attachment"]') as HTMLButtonElement | null;
    expect(composerState?.getAttribute("data-send-phase")).toBe("preparingSend");
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(true);

    await dispatchChatPanelDragEvent(createDropEvent(new File(["pending"], "pending.txt", { type: "text/plain" })));
    await flushAsync();

    expect(prepareAttachmentMock).not.toHaveBeenCalled();
  });

  it("ignores delayed attachment processing after the composer becomes locked", async () => {
    let resolveDelayedAttachment: (() => void) | null = null;
    const runSyncMock = vi.fn(() => new Promise<void>(() => undefined));
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
    prepareAttachmentMock.mockImplementation(() => new Promise((resolve) => {
      resolveDelayedAttachment = () => resolve({
        type: "binary",
        fileName: "delayed.txt",
        mediaType: "text/plain",
        base64Data: "ZGVsYXllZA==",
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await dispatchChatPanelDragEvent(createDropEvent(new File(["delayed"], "delayed.txt", { type: "text/plain" })));
    await flushAsync();

    expect(prepareAttachmentMock).toHaveBeenCalledTimes(1);

    await sendMessage("hello");
    await flushAsync();

    const composerState = getContainer().querySelector('[data-testid="chat-composer-state"]') as HTMLDivElement | null;
    expect(composerState?.getAttribute("data-send-phase")).toBe("preparingSend");
    expect(resolveDelayedAttachment).not.toBeNull();

    await act(async () => {
      resolveDelayedAttachment?.();
      await Promise.resolve();
    });
    await flushAsync();

    expect(getContainer().textContent).not.toContain("delayed.txt");
    expect(readStoredDraftPendingAttachmentCount("session-1")).toBe(0);
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

    const textareaBeforeFailure = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textareaBeforeFailure?.value).toBe("");
    expect(readStoredDraftInputText(sessionId as string)).toBe("keep this draft");

    rejectRunSync?.(new Error("sync failed"));
    await flushAsync();
    await flushAsync();

    const textareaAfterFailure = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textareaAfterFailure?.value).toBe("keep this draft");
    expect(readStoredDraftInputText(sessionId as string)).toBe("keep this draft");
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

    expect((getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null)?.value).toBe("");
    expect(readStoredDraftInputText(sessionId as string)).toBe("keep this draft");

    rejectStartRun?.(new Error("Request failed with status 500"));
    await flushAsync();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("keep this draft");
    expect(readStoredDraftInputText(sessionId as string)).toBe("keep this draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("restores the stored draft after a refresh while turn acceptance is still pending", async () => {
    startChatRunMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    const textareaBeforeRefresh = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textareaBeforeRefresh?.value).toBe("");
    expect(readStoredDraftInputText(sessionId as string)).toBe("keep this draft");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterRefresh = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textareaAfterRefresh?.value).toBe("keep this draft");
    expect(readStoredDraftInputText(sessionId as string)).toBe("keep this draft");
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

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("second turn");
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("A response is already in progress.");
  });

  it("does not open an error dialog when assistant_message_done is followed by stream close", async () => {
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "assistant_delta",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        text: "All set.",
        cursor: "cursor-1",
        itemId: "item-1",
      });
      onEvent({
        type: "assistant_message_done",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 2,
        streamEpoch: "epoch-1",
        cursor: "cursor-1",
        itemId: "item-1",
        content: [{ type: "text", text: "All set." }],
        isError: false,
        isStopped: false,
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalled();
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("AI live stream ended before the run finished.");
  });
});
