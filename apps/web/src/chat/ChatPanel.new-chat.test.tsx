// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { persistLocalePreference } from "../i18n/runtime";
import {
  createChatActiveRun,
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
  setLocalePreference,
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

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
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

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    expect(textarea?.value).toBe("");

    const draftsAfterNew = loadChatDraftWorkspaceState("workspace-1");
    expect(readChatDraftForSession(draftsAfterNew, "session-1")?.inputText).toBe("keep this draft");
    expect(readChatDraftForSession(draftsAfterNew, createNewChatSessionMock.mock.calls[1]?.[0] as string)).toBeNull();
  });

  it("keeps bootstrap drafts transient while the snapshot refresh is unresolved", async () => {
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

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    const draftsAfterNew = loadChatDraftWorkspaceState("workspace-1");
    expect(Object.keys(draftsAfterNew)).toHaveLength(0);
    expect(createNewChatSessionMock.mock.calls[1]?.[0]).toMatch(UUID_PATTERN);
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
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
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
    createNewChatSessionMock
      .mockResolvedValueOnce({
        ok: true,
        sessionId: "session-bootstrap",
        composerSuggestions: [],
        chatConfig: createChatSnapshot().chatConfig,
      })
      .mockRejectedValueOnce(new Error("Request failed with status 500"));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();
    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
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

  it("ignores a late accepted send from the previous conversation after a new chat reset", async () => {
    let resolveStartRun: (() => void) | null = null;
    let initialSessionId: string | null = null;
    const staleSuggestions = [{
      id: "stale-1",
      text: "Stale suggestion",
      source: "assistant_follow_up" as const,
      assistantItemId: "assistant-stale",
    }];

    startChatRunMock.mockImplementation(async (requestBody) => new Promise((resolve) => {
      initialSessionId = requestBody.sessionId;
      resolveStartRun = () => resolve({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          composerSuggestions: staleSuggestions,
          activeRun: createChatActiveRun(),
        }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();

    await sendMessage("hello before reset");
    await flushAsync();

    const newButton = getContainer().querySelector('[data-testid="chat-new-button"]') as HTMLButtonElement | null;
    expect(newButton).not.toBeNull();
    expect(newButton?.disabled).toBe(false);

    await clickNewConversation();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await setTextareaValue(textarea as HTMLTextAreaElement, "fresh draft");
    await flushAsync();

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();

    expect(initialSessionId).not.toBeNull();
    expect(textarea?.value).toBe("fresh draft");
    expect(getContainer().querySelectorAll(".chat-msg").length).toBe(0);
    expect(getContainer().textContent).not.toContain("Stale suggestion");
  });

  it("waits for the new-session provisioning response before starting the next send", async () => {
    let resolveNewSession: ((value: {
      ok: true;
      sessionId: string;
      composerSuggestions: [];
      chatConfig: ReturnType<typeof createChatSnapshot>["chatConfig"];
    }) => void) | null = null;
    createNewChatSessionMock.mockImplementation((sessionId: string) => new Promise((resolve) => {
      resolveNewSession = resolve;
      if (createNewChatSessionMock.mock.calls.length === 1) {
        resolve({
          ok: true,
          sessionId,
          composerSuggestions: [],
          chatConfig: createChatSnapshot().chatConfig,
        });
      }
    }));

    await renderChatPanel();
    await flushAsync();

    await clickNewConversation();
    await flushAsync();

    await sendMessage("hello after new");
    await flushAsync();

    const createdSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof createdSessionId).toBe("string");
    expect(startChatRunMock).not.toHaveBeenCalled();

    resolveNewSession?.({
      ok: true,
      sessionId: createdSessionId as string,
      composerSuggestions: [],
      chatConfig: createChatSnapshot().chatConfig,
    });
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: createdSessionId,
    }));
  });

  it("sends the current app locale when provisioning a fresh chat session", async () => {
    persistLocalePreference("es-MX");

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledWith(
      expect.any(String),
      "es-MX",
    );
  });

  it("reprovisions idle composer suggestions when the app locale changes", async () => {
    const englishSuggestion = [{
      id: "suggestion-en",
      text: "Study with spaced repetition",
      source: "initial" as const,
      assistantItemId: null,
    }];
    const spanishSuggestion = [{
      id: "suggestion-es",
      text: "Estudia con repeticion espaciada",
      source: "initial" as const,
      assistantItemId: null,
    }];
    let secondRequestResolved = false;
    let resolveSecondRequest: ((value: {
      ok: true;
      sessionId: string;
      composerSuggestions: typeof spanishSuggestion;
      chatConfig: ReturnType<typeof createChatSnapshot>["chatConfig"];
    }) => void) | null = null;

    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      composerSuggestions: englishSuggestion,
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }));
    createNewChatSessionMock.mockImplementation((sessionId: string, uiLocale: string) => {
      if (uiLocale === "en") {
        return Promise.resolve({
          ok: true,
          sessionId,
          composerSuggestions: [],
          chatConfig: createChatSnapshot().chatConfig,
        });
      }

      return new Promise((resolve) => {
        resolveSecondRequest = (value) => {
          secondRequestResolved = true;
          resolve(value);
        };
      });
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Study with spaced repetition");

    await setLocalePreference("es-MX");
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    expect(createNewChatSessionMock.mock.calls[0]?.[0]).toBe(createNewChatSessionMock.mock.calls[1]?.[0]);
    expect(createNewChatSessionMock.mock.calls[1]?.[1]).toBe("es-MX");
    expect(getContainer().textContent).not.toContain("Study with spaced repetition");
    expect(secondRequestResolved).toBe(false);

    resolveSecondRequest?.({
      ok: true,
      sessionId: createNewChatSessionMock.mock.calls[1]?.[0] as string,
      composerSuggestions: spanishSuggestion,
      chatConfig: createChatSnapshot().chatConfig,
    });
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Estudia con repeticion espaciada");
    expect(getContainer().textContent).not.toContain("Study with spaced repetition");
  });

  it("ignores late fresh-session provisioning responses from the previous locale", async () => {
    const englishSuggestion = [{
      id: "suggestion-en",
      text: "Old locale suggestion",
      source: "initial" as const,
      assistantItemId: null,
    }];
    const spanishSuggestion = [{
      id: "suggestion-es",
      text: "Nueva sugerencia",
      source: "initial" as const,
      assistantItemId: null,
    }];
    let freshSessionId: string | null = null;
    let resolveEnglishRequest: ((value: {
      ok: true;
      sessionId: string;
      composerSuggestions: typeof englishSuggestion;
      chatConfig: ReturnType<typeof createChatSnapshot>["chatConfig"];
    }) => void) | null = null;
    let resolveSpanishRequest: ((value: {
      ok: true;
      sessionId: string;
      composerSuggestions: typeof spanishSuggestion;
      chatConfig: ReturnType<typeof createChatSnapshot>["chatConfig"];
    }) => void) | null = null;

    createNewChatSessionMock.mockImplementation((sessionId: string, uiLocale: string) => {
      if (uiLocale === "en") {
        if (createNewChatSessionMock.mock.calls.length === 1) {
          return Promise.resolve({
            ok: true,
            sessionId,
            composerSuggestions: [],
            chatConfig: createChatSnapshot().chatConfig,
          });
        }

        freshSessionId = sessionId;
        return new Promise((resolve) => {
          resolveEnglishRequest = resolve;
        });
      }

      freshSessionId = sessionId;
      return new Promise((resolve) => {
        resolveSpanishRequest = resolve;
      });
    });

    await renderChatPanel();
    await flushAsync();

    await clickNewConversation();
    await flushAsync();

    await setLocalePreference("es-MX");
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(3);
    expect(createNewChatSessionMock.mock.calls[1]?.[0]).toBe(freshSessionId);
    expect(createNewChatSessionMock.mock.calls[2]?.[0]).toBe(freshSessionId);
    expect(createNewChatSessionMock.mock.calls[2]?.[1]).toBe("es-MX");

    resolveSpanishRequest?.({
      ok: true,
      sessionId: freshSessionId ?? "session-1",
      composerSuggestions: spanishSuggestion,
      chatConfig: createChatSnapshot().chatConfig,
    });
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Nueva sugerencia");

    resolveEnglishRequest?.({
      ok: true,
      sessionId: freshSessionId ?? "session-1",
      composerSuggestions: englishSuggestion,
      chatConfig: createChatSnapshot().chatConfig,
    });
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Nueva sugerencia");
    expect(getContainer().textContent).not.toContain("Old locale suggestion");
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
      if (createNewChatSessionMock.mock.calls.length === 1) {
        return Promise.resolve({
          ok: true,
          sessionId,
          composerSuggestions: [],
          chatConfig: createChatSnapshot().chatConfig,
        });
      }

      createdSessionId = sessionId;
      return new Promise<NewChatSessionResponse>((resolve) => {
        resolveEnsure = resolve;
      });
    });
    startChatRunMock.mockImplementation(async (requestBody) => {
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
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => {
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

    resolveEnsure?.({
      ok: true,
      sessionId: createdSessionId ?? "session-new",
      composerSuggestions: initialSuggestions,
      chatConfig: createChatSnapshot().chatConfig,
    });
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Fresh suggestion");
    expect(getContainer().textContent).not.toContain("Initial suggestion");
  });
});
