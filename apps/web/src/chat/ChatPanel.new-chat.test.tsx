// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import {
  createCompletedToolCallAssistantMessage,
  createVerifiedWorkspaceAppDataMock,
} from "./ChatPanelTestFixtures";
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
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: null,
          cursor: null,
        })],
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

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
