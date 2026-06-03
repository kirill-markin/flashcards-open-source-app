// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ApiErrorMock,
  captureWebExceptionMock,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  setupChatPanelTest,
  useAppDataMock,
} from "./support/ChatPanelTestSupport";
import {
  createUnverifiedWorkspaceAppDataMock,
  createVerifiedWorkspaceAppDataMock,
} from "./support/ChatPanelTestFixtures";
import { storeChatSessionWarmStartSnapshot } from "../../sessionController/warmStart";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
} = setupChatPanelTest();

describe("ChatPanel hydration lifecycle", () => {
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

  it("captures unexpected silent fresh-session failures", async () => {
    const staleTimestamp = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(new Date(staleTimestamp + (6 * 60 * 60 * 1000) + 1_000));
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-stale",
      conversationScopeId: "session-stale",
      conversation: {
        updatedAt: staleTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "user",
          content: [{ type: "text", text: "Old question" }],
          timestamp: staleTimestamp,
          isError: false,
          isStopped: false,
        }],
      },
    }), false);
    const freshSessionError = Object.assign(
      new ApiErrorMock(503, "Fresh session failed.", "INTERNAL_ERROR"),
      { responseBodyKind: "json" as const },
    );
    createNewChatSessionMock.mockRejectedValue(freshSessionError);

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(captureWebExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "chat_run_request_failed",
      error: freshSessionError,
      details: {
        operation: "chat_fresh_session_failed",
        sessionId,
        workspaceId: "workspace-1",
      },
    }));
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
});
