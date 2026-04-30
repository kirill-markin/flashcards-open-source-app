// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  getChatSnapshotMock,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import {
  createCompletedToolCallAssistantMessage,
  createVerifiedWorkspaceAppDataMock,
} from "./ChatPanelTestFixtures";
import {
  loadChatSessionWarmStartSnapshot,
  storeChatSessionWarmStartSnapshot,
} from "../sessionController/warmStart";

const {
  flushAsync,
  renderChatPanel,
  sendMessage,
  unmountChatPanel,
} = setupChatPanelTest();

describe("ChatPanel post-run sync", () => {
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
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: null,
          cursor: null,
        })],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: setErrorMessageMock,
    }));

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
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: null,
          cursor: null,
        })],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

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
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: null,
          cursor: null,
        })],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

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
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: null,
          cursor: null,
        })],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", completedToolSnapshot, true);
    getChatSnapshotMock.mockResolvedValue(completedToolSnapshot);
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

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
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: null,
          cursor: null,
        })],
      },
    });
    storeChatSessionWarmStartSnapshot("workspace-1", historicalToolSnapshot, false);
    getChatSnapshotMock.mockResolvedValue(historicalToolSnapshot);
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("uses runSync instead of refreshLocalData for the tool-backed AI run path", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent, runId, sessionId }) => {
      onEvent({
        type: "assistant_tool_call",
        sessionId,
        conversationScopeId: sessionId,
        runId,
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
        sessionId,
        conversationScopeId: sessionId,
        runId,
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

    expect(runSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalDataMock).not.toHaveBeenCalled();
  });

  it("waits for run_terminal before the tool-backed post-run sync", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    const runSyncMock = vi.fn(async (): Promise<void> => undefined);
    let releaseRunTerminal: (() => void) | null = null;
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent, runId, sessionId }) => {
      onEvent({
        type: "assistant_tool_call",
        sessionId,
        conversationScopeId: sessionId,
        runId,
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
        sessionId,
        conversationScopeId: sessionId,
        runId,
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
        sessionId,
        conversationScopeId: sessionId,
        runId,
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
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
            createCompletedToolCallAssistantMessage({
              timestamp: 2,
              isStopped: true,
              itemId: "item-1",
              cursor: "cursor-1",
            }),
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
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
            createCompletedToolCallAssistantMessage({
              timestamp: 3,
              isStopped: false,
              itemId: "item-current",
              cursor: "cursor-current",
            }),
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
    startChatRunMock.mockResolvedValue({
      accepted: true,
      sessionId: "session-1",
      conversationScopeId: "session-1",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [createCompletedToolCallAssistantMessage({
          timestamp: 2,
          isStopped: false,
          itemId: "item-1",
          cursor: "cursor-1",
        })],
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
    startChatRunMock.mockResolvedValue({
      accepted: true,
      sessionId: "session-1",
      conversationScopeId: "session-1",
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
          messages: [createCompletedToolCallAssistantMessage({
            timestamp: 2,
            isStopped: false,
            itemId: null,
            cursor: null,
          })],
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
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
          createCompletedToolCallAssistantMessage({
            timestamp: 2,
            isStopped: false,
            itemId: "item-old-tool",
            cursor: "cursor-old-tool",
          }),
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
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: refreshLocalDataMock,
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
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
          createCompletedToolCallAssistantMessage({
            timestamp: 2,
            isStopped: false,
            itemId: null,
            cursor: null,
          }),
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
});
