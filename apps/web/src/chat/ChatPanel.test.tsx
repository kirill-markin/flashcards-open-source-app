// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ApiErrorMock,
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  pressTextareaKey,
  setTextareaSelection,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import {
  loadChatDraftWorkspaceState,
  readChatDraftForSession,
} from "./chatDraftStorage";
import {
  loadChatSessionWarmStartSnapshot,
  storeChatSessionWarmStartSnapshot,
} from "./sessionController/warmStart";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  unmountChatPanel,
  clickNewConversation,
  clickAddAttachment,
  setMobileViewport,
  sendMessage,
} = setupChatPanelTest();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("ChatPanel new chat", () => {
  it("clears the conversation after a successful new-session response", async () => {
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
    await clickNewConversation();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelectorAll(".chat-msg").length).toBe(0);
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("keeps the previous session draft when rolling to a fresh chat", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }));

    await renderChatPanel();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await setTextareaValue(textarea as HTMLTextAreaElement, "keep this draft");
    await flushAsync();

    const draftsBeforeNew = loadChatDraftWorkspaceState("workspace-1");
    expect(readChatDraftForSession(draftsBeforeNew, "session-1")?.inputText).toBe("keep this draft");

    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("");

    const draftsAfterNew = loadChatDraftWorkspaceState("workspace-1");
    expect(readChatDraftForSession(draftsAfterNew, "session-1")?.inputText).toBe("keep this draft");
    expect(readChatDraftForSession(draftsAfterNew, createNewChatSessionMock.mock.calls[0]?.[0] as string)).toBeNull();
  });

  it("keeps unresolved bootstrap drafts transient until a real session id exists", async () => {
    getChatSnapshotMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await setTextareaValue(textarea as HTMLTextAreaElement, "pending draft");
    await clickAddAttachment();
    await flushAsync();

    const draftsBeforeNew = loadChatDraftWorkspaceState("workspace-1");
    const draftSessionIdsBeforeNew = Object.keys(draftsBeforeNew);
    expect(draftSessionIdsBeforeNew).toHaveLength(0);
    expect(textarea?.value).toBe("pending draft");
    expect(getContainer().textContent).toContain("attached.txt");

    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    const draftsAfterNew = loadChatDraftWorkspaceState("workspace-1");
    expect(Object.keys(draftsAfterNew)).toHaveLength(0);
    expect(createNewChatSessionMock.mock.calls[0]?.[0]).toMatch(UUID_PATTERN);
    expect(textarea?.value).toBe("");
    expect(getContainer().textContent).not.toContain("attached.txt");
  });

  it("clears a stale pending post-run sync flag when starting a new conversation", async () => {
    const runSyncMock = vi.fn(async (): Promise<void> => {
      throw new Error("sync failed");
    });
    const staleToolSnapshot = createChatSnapshot({
      sessionId: "session-old",
      conversationScopeId: "session-old",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", staleToolSnapshot, true);
    getChatSnapshotMock.mockImplementation(async (sessionId?: string) => createChatSnapshot({
      sessionId: sessionId ?? "session-old",
      conversationScopeId: sessionId ?? "session-old",
      conversation: {
        updatedAt: 3,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }));
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);

    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    const freshSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof freshSessionId).toBe("string");
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.sessionId).toBe(freshSessionId);
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("shows an in-chat error dialog when background new-session ensure fails", async () => {
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
    createNewChatSessionMock.mockRejectedValue(new Error("Request failed with status 500"));

    await renderChatPanel();
    await flushAsync();
    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(getContainer().textContent).toContain("AI chat error");
    expect(getContainer().textContent).toContain("New chat failed. Request failed with status 500");
  });

  it("returns focus to the composer after a successful new chat reset", async () => {
    await renderChatPanel();
    await flushAsync();

    const newButton = [...getContainer().querySelectorAll(".chat-close-btn")]
      .find((button) => button.textContent === "New") as HTMLButtonElement | undefined;
    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;

    expect(newButton).toBeDefined();
    expect(textarea).not.toBeNull();

    newButton?.focus();
    expect(document.activeElement).toBe(newButton);

    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(document.activeElement).toBe(textarea);
  });

  it("keeps send working while the background new-session ensure is still pending", async () => {
    createNewChatSessionMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();

    await clickNewConversation();
    await flushAsync();

    await sendMessage("hello after new");
    await flushAsync();

    const createdSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof createdSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: createdSessionId,
    }));
  });

  it("does not let a late new-session ensure overwrite fresh suggestions after send", async () => {
    const initialSuggestions = [{
      id: "initial-1",
      text: "Initial suggestion",
      source: "initial" as const,
      assistantItemId: null,
    }];
    const freshSuggestions = [{
      id: "fresh-1",
      text: "Fresh suggestion",
      source: "assistant_follow_up" as const,
      assistantItemId: "assistant-1",
    }];
    type NewChatSessionResponse = Readonly<{
      ok: true;
      sessionId: string;
      composerSuggestions: typeof initialSuggestions;
      chatConfig: ReturnType<typeof createChatSnapshot>["chatConfig"];
    }>;
    let createdSessionId: string | null = null;
    let resolveEnsure: ((response: NewChatSessionResponse) => void) | null = null;

    createNewChatSessionMock.mockImplementation((sessionId: string) => {
      createdSessionId = sessionId;
      return new Promise<NewChatSessionResponse>((resolve) => {
        resolveEnsure = resolve;
      });
    });
    startChatRunMock.mockImplementation(async (requestBody: { sessionId?: string }) => {
      expect(requestBody.sessionId).toBe(createdSessionId);
      return {
        accepted: true,
        sessionId: createdSessionId ?? "session-new",
        conversationScopeId: createdSessionId ?? "session-new",
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [],
        },
        composerSuggestions: freshSuggestions,
        chatConfig: createChatSnapshot().chatConfig,
        activeRun: null,
      };
    });
    getChatSnapshotMock.mockImplementation(async (sessionId?: string) => {
      if (sessionId === createdSessionId) {
        return createChatSnapshot({
          sessionId,
          conversationScopeId: sessionId,
          composerSuggestions: freshSuggestions,
          conversation: {
            updatedAt: 2,
            mainContentInvalidationVersion: 0,
            messages: [],
          },
        });
      }

      return createChatSnapshot();
    });

    await renderChatPanel();
    await flushAsync();

    await clickNewConversation();
    await flushAsync();

    await sendMessage("hello after new");
    await flushAsync();

    expect(getContainer().textContent).toContain("Fresh suggestion");
    expect(getContainer().textContent).not.toContain("Initial suggestion");

    resolveEnsure?.({
      ok: true,
      sessionId: createdSessionId ?? "session-new",
      composerSuggestions: initialSuggestions,
      chatConfig: createChatSnapshot().chatConfig,
    });
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Fresh suggestion");
    expect(getContainer().textContent).not.toContain("Initial suggestion");
  });
});

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

    useAppDataMock.mockReturnValue({
      sessionVerificationState: "unverified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: false,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

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

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-local-fresh");
  });

  it("post-run sync failure keeps pending flag across reload", async () => {
    const runSyncMock = vi.fn(async (): Promise<void> => {
      throw new Error("sync failed");
    });
    const setErrorMessageMock = vi.fn();
    const completedToolSnapshot = createChatSnapshot({
      sessionId: "session-tool-run",
      conversationScopeId: "session-tool-run",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: setErrorMessageMock,
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(setErrorMessageMock).toHaveBeenCalledWith("Chat sync failed. sync failed");
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(true);
  });

  it("reload retries post-run sync when previous attempt failed", async () => {
    const runSyncMock = vi.fn(async (): Promise<void> => {
      throw new Error("sync failed");
    });
    const completedToolSnapshot = createChatSnapshot({
      sessionId: "session-tool-run",
      conversationScopeId: "session-tool-run",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(2);
  });

  it("successful post-run sync clears pending flag", async () => {
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    const completedToolSnapshot = createChatSnapshot({
      sessionId: "session-tool-run",
      conversationScopeId: "session-tool-run",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("duplicate terminal and hydration triggers still perform one sync attempt at a time", async () => {
    let currentVisibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => currentVisibilityState,
    });

    let resolveRunSync: (() => void) | null = null;
    const runSyncMock = vi.fn(() => new Promise<void>((resolve) => {
      resolveRunSync = resolve;
    }));
    const completedToolSnapshot = createChatSnapshot({
      sessionId: "session-tool-run",
      conversationScopeId: "session-tool-run",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);

    currentVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    currentVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(runSyncMock).toHaveBeenCalledTimes(1);

    resolveRunSync?.();
    await flushAsync();
    await flushAsync();

    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);
  });

  it("does not run post-run sync for an already-synced historical tool chat", async () => {
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    const historicalToolSnapshot = createChatSnapshot({
      sessionId: "session-history",
      conversationScopeId: "session-history",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", historicalToolSnapshot, false);
    getChatSnapshotMock.mockResolvedValue(historicalToolSnapshot);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).not.toHaveBeenCalled();
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

    expect(getChatSnapshotMock).toHaveBeenCalledWith("session-assistant-only");
    expect(createNewChatSessionMock).not.toHaveBeenCalled();
  });

  it("preserves latest-or-create bootstrap when no warm-start session id exists", async () => {
    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock.mock.calls[0]?.[0]).toBeUndefined();
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

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(textarea?.value).toBe("");
    expect(document.activeElement).toBe(textarea);
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
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "unverified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: false,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

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
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-2",
        name: "Secondary",
        createdAt: "2026-03-11T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getChatSnapshotMock.mock.calls[1]?.[0]).toBeUndefined();
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
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "unverified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: false,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();

    expect(getContainer().textContent).toContain("Warm start response");
    expect(getContainer().textContent).not.toContain("Loading AI chat");
    expect(getContainer().textContent).not.toContain("Start a new AI chat");
  });

  it("does not restart initial hydration for the same workspace after a failed snapshot refresh", async () => {
    getChatSnapshotMock.mockRejectedValue(new Error("Request failed with status 500"));

    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

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

  it("disables starting a new chat while turn acceptance is still in flight", async () => {
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
    expect((newButton as HTMLButtonElement).disabled).toBe(true);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("keeps the draft when startRun fails before the server accepts the turn", async () => {
    startChatRunMock.mockRejectedValue(new Error("Request failed with status 500"));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("keep this draft");
    await flushAsync();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("keep this draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
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

  it("uses runSync instead of refreshLocalData for the tool-backed AI run path", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "assistant_tool_call",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        cursor: "cursor-1",
        toolCallId: "tool-1",
        itemId: "item-1",
        outputIndex: 0,
        name: "agent_sql",
        status: "started",
        input: "update cards set back_text = 'Updated answer'",
        output: "{\"ok\":true}",
        providerStatus: null,
      });
      onEvent({
        type: "run_terminal",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 2,
        streamEpoch: "epoch-1",
        cursor: null,
        outcome: "completed",
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("update the current card");
    await flushAsync();
    await flushAsync();

    // Web keeps the blocking pre-send sync and adds one post-run sync after a
    // tool-backed run, so the full happy path uses runSync twice.
    expect(runSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
  });

  it("waits for run_terminal before the tool-backed post-run sync", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    let releaseRunTerminal: (() => void) | null = null;
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "assistant_tool_call",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        cursor: "cursor-1",
        toolCallId: "tool-1",
        itemId: "item-1",
        outputIndex: 0,
        name: "agent_sql",
        status: "started",
        input: "update cards set back_text = 'Updated answer'",
        output: "{\"ok\":true}",
        providerStatus: null,
      });
      onEvent({
        type: "assistant_message_done",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 2,
        streamEpoch: "epoch-1",
        cursor: "cursor-2",
        itemId: "item-1",
        content: [{ type: "text", text: "Updated." }],
        isError: false,
        isStopped: false,
      });
      await new Promise<void>((resolve) => {
        releaseRunTerminal = resolve;
      });
      onEvent({
        type: "run_terminal",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 3,
        streamEpoch: "epoch-1",
        cursor: "cursor-3",
        outcome: "completed",
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("update the current card");
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();

    releaseRunTerminal?.();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
  });

  it("does not arm post-run sync from historical tool calls in a running accepted response", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    startChatRunMock.mockResolvedValue({
      ...createChatSnapshot({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Previous question" }],
              timestamp: 1,
              isError: false,
              isStopped: false,
            },
            {
              role: "assistant",
              content: [{
                type: "tool_call",
                id: "tool-1",
                name: "search_cards",
                status: "completed",
                input: "{\"query\":\"biology\"}",
                output: "{\"matches\":3}",
              }],
              timestamp: 2,
              isError: false,
              isStopped: true,
              itemId: "item-1",
              cursor: "cursor-1",
            },
          ],
        },
        activeRun: createChatActiveRun(),
      }),
      accepted: true,
    });
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "run_terminal",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        cursor: null,
        outcome: "completed",
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("New plain-text turn");
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);
  });

  it("runs one post-run sync when a running accepted response adds a new tool-call tail after historical messages", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Previous question" }],
            timestamp: 1,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Previous answer" }],
            timestamp: 2,
            isError: false,
            isStopped: true,
            itemId: "item-previous",
            cursor: "cursor-previous",
          },
        ],
      },
    }));
    startChatRunMock.mockResolvedValue({
      ...createChatSnapshot({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        conversation: {
          updatedAt: 3,
          mainContentInvalidationVersion: 0,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Previous question" }],
              timestamp: 1,
              isError: false,
              isStopped: false,
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Previous answer" }],
              timestamp: 2,
              isError: false,
              isStopped: true,
              itemId: "item-previous",
              cursor: "cursor-previous",
            },
            {
              role: "assistant",
              content: [{
                type: "tool_call",
                id: "tool-1",
                name: "search_cards",
                status: "completed",
                input: "{\"query\":\"biology\"}",
                output: "{\"matches\":3}",
              }],
              timestamp: 3,
              isError: false,
              isStopped: false,
              itemId: "item-current",
              cursor: "cursor-current",
            },
          ],
        },
        activeRun: createChatActiveRun(),
      }),
      accepted: true,
    });
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "run_terminal",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        cursor: null,
        outcome: "completed",
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("Find biology cards again");
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);
  });

  it("runs one post-run sync when an active accepted response already has trailing tool-call content", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    startChatRunMock.mockResolvedValue({
      accepted: true,
      sessionId: "session-1",
      conversationScopeId: "session-1",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
          itemId: "item-1",
          cursor: "cursor-1",
        }],
      },
      composerSuggestions: [],
      chatConfig: createChatSnapshot().chatConfig,
      activeRun: createChatActiveRun(),
    });
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "run_terminal",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        cursor: null,
        outcome: "completed",
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("find biology cards");
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);
  });

  it("runs one post-run sync when the accepted terminal response already contains a tool call", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    startChatRunMock.mockResolvedValue({
      accepted: true,
      sessionId: "session-1",
      conversationScopeId: "session-1",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{
            type: "tool_call",
            id: "tool-1",
            name: "search_cards",
            status: "completed",
            input: "{\"query\":\"biology\"}",
            output: "{\"matches\":3}",
          }],
          timestamp: 2,
          isError: false,
          isStopped: false,
        }],
      },
      composerSuggestions: [],
      chatConfig: createChatSnapshot().chatConfig,
      activeRun: null,
    });
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{
              type: "tool_call",
              id: "tool-1",
              name: "search_cards",
              status: "completed",
              input: "{\"query\":\"biology\"}",
              output: "{\"matches\":3}",
            }],
            timestamp: 2,
            isError: false,
            isStopped: false,
          }],
        },
        activeRun: null,
      }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("find biology cards");
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
  });

  it("does not arm terminal post-run sync from an older assistant item when the latest assistant-only reply is plain text", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    startChatRunMock.mockResolvedValue({
      accepted: true,
      sessionId: "session-1",
      conversationScopeId: "session-1",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Older question" }],
            timestamp: 1,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{
              type: "tool_call",
              id: "tool-1",
              name: "search_cards",
              status: "completed",
              input: "{\"query\":\"biology\"}",
              output: "{\"matches\":3}",
            }],
            timestamp: 2,
            isError: false,
            isStopped: false,
            itemId: "item-old-tool",
            cursor: "cursor-old-tool",
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Plain terminal reply" }],
            timestamp: 3,
            isError: false,
            isStopped: false,
            itemId: "item-new-text",
            cursor: "cursor-new-text",
          },
        ],
      },
      composerSuggestions: [],
      chatConfig: createChatSnapshot().chatConfig,
      activeRun: null,
    });
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        conversation: {
          updatedAt: 3,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{ type: "text", text: "Plain terminal reply" }],
            timestamp: 3,
            isError: false,
            isStopped: false,
            itemId: "item-new-text",
            cursor: "cursor-new-text",
          }],
        },
        activeRun: null,
      }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("New plain-text turn");
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
    expect(loadChatSessionWarmStartSnapshot("workspace-1")?.pendingToolRunPostSync).toBe(false);
  });

  it("runs one post-run sync when a restored active run already has tool-call content", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    });
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Earlier completed reply" }],
            timestamp: 1,
            isError: false,
            isStopped: true,
          },
          {
            role: "assistant",
            content: [{
              type: "tool_call",
              id: "tool-1",
              name: "search_cards",
              status: "completed",
              input: "{\"query\":\"biology\"}",
              output: "{\"matches\":3}",
            }],
            timestamp: 2,
            isError: false,
            isStopped: false,
          },
        ],
      },
      activeRun: createChatActiveRun(),
    }));
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "run_terminal",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        cursor: null,
        outcome: "completed",
      });
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
  });

  it("reconciles a clean unexpected EOF without opening an error dialog", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        activeRun: null,
      }));
    consumeChatLiveStreamMock.mockResolvedValue(undefined);

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("opens an error dialog when unexpected EOF still reconciles to a running run", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        activeRun: createChatActiveRun(),
      }));
    consumeChatLiveStreamMock.mockResolvedValue(undefined);

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("AI live stream ended before the run finished.");
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("ignores duplicate visible visibilitychange events while the live stream is already connected", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    consumeChatLiveStreamMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();
    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("renders completed reasoning summaries with the completed tool-call styling", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "reasoning_summary", summary: "Compared due cards and queued a search.", status: "completed" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      },
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getContainer().querySelector(".chat-tool-call-completed")).not.toBeNull();
    expect(getContainer().querySelector(".chat-tool-call-started")).toBeNull();
    expect(getContainer().textContent).toContain("Reasoning");
    expect(getContainer().textContent).toContain("Done");
  });
});
