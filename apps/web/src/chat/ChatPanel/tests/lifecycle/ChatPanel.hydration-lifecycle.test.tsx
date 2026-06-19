// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useRef, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  ApiErrorMock,
  configureMessagesScroller,
  captureWebExceptionMock,
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  readStoredDraftInputText,
  setupChatPanelTest,
  setTextareaValue,
  useAppDataMock,
} from "../support/ChatPanelTestSupport";
import {
  createUnverifiedWorkspaceAppDataMock,
  createVerifiedWorkspaceAppDataMock,
} from "../support/ChatPanelTestFixtures";
import { useChatAutoScroll } from "../../../history/useChatAutoScroll";
import type { StoredMessage } from "../../../history/useChatHistory";
import { storeChatSessionWarmStartSnapshot } from "../../../sessionController/lifecycle/warmStart";
import type { ChatLiveEvent } from "../../../streaming/liveStream";

const {
  flushAsync,
  getContainer,
  hideChatPanel,
  renderChatPanel,
  setMessagesScrollerMetrics,
} = setupChatPanelTest();

function queryMessagesScroller(container: ParentNode): HTMLDivElement {
  const scroller = container.querySelector('[data-testid="chat-messages"]') as HTMLDivElement | null;
  expect(scroller).not.toBeNull();
  if (scroller === null) {
    throw new Error("Expected chat messages scroller");
  }

  return scroller;
}

async function finishProgrammaticScrollSuppression(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
  });
}

async function detachMessagesScroller(scroller: HTMLDivElement, scrollTop: number): Promise<void> {
  await act(async () => {
    scroller.dispatchEvent(new Event("wheel", { bubbles: true }));
    scroller.scrollTop = scrollTop;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await Promise.resolve();
  });
}

const emptyStoredMessages: ReadonlyArray<StoredMessage> = [];

type AutoScrollHarnessProps = Readonly<{
  metrics: Readonly<{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }>;
  scrollKey: string;
}>;

function AutoScrollHarness(props: AutoScrollHarnessProps): ReactElement {
  const { metrics, scrollKey } = props;
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const { handleMessagesScroll } = useChatAutoScroll({
    isHydrated: true,
    isStreaming: false,
    messages: emptyStoredMessages,
    messagesRef,
    messagesContentRef,
    scrollKey,
  });

  useLayoutEffect(() => {
    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    configureMessagesScroller(element, metrics);
  }, [metrics]);

  return createElement(
    "div",
    {
      "data-testid": "auto-scroll-harness",
      onScroll: handleMessagesScroll,
      ref: messagesRef,
    },
    createElement("div", { ref: messagesContentRef }),
  );
}

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

  it("keeps a typed draft when hydration accepts a replacement session id", async () => {
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId: "session-pending",
      conversationScopeId: "session-pending",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }), false);
    getChatSnapshotMock.mockImplementationOnce((sessionId: string) => new Promise((resolve) => {
      resolveHydrationSnapshot = (snapshot) => resolve(snapshot);
      expect(sessionId).toBe("session-pending");
    }));

    await renderChatPanel();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await setTextareaValue(textarea as HTMLTextAreaElement, "draft typed during hydration");
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", "session-pending")).toBe("draft typed during hydration");

    resolveHydrationSnapshot?.(createChatSnapshot({
      sessionId: "session-accepted",
      conversationScopeId: "session-accepted",
      conversation: {
        updatedAt: 2,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
    }));
    await flushAsync();
    await flushAsync();

    const acceptedTextarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(acceptedTextarea?.value).toBe("draft typed during hydration");
    expect(readStoredDraftInputText("workspace-1", "session-pending")).toBeNull();
    expect(readStoredDraftInputText("workspace-1", "session-accepted")).toBe("draft typed during hydration");
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

  it("preserves detached middle scroll when a hydrated session remounts", async () => {
    const sessionId = "session-scroll-remount";
    const freshTimestamp = Date.now();
    getChatSnapshotMock.mockImplementation(() => new Promise(() => undefined));
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      conversation: {
        updatedAt: freshTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Older question" }],
            timestamp: freshTimestamp,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Older answer" }],
            timestamp: freshTimestamp + 1,
            isError: false,
            isStopped: false,
          },
        ],
      },
    }), false);

    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_000,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();

    const scroller = queryMessagesScroller(getContainer());
    await finishProgrammaticScrollSuppression();
    await detachMessagesScroller(scroller, 320);

    expect(scroller.scrollTop).toBe(320);

    await hideChatPanel();
    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_000,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();

    const remountedScroller = queryMessagesScroller(getContainer());
    expect(remountedScroller.scrollTop).toBe(320);
  });

  it("keeps detached scroll state attached to the previous key when the scroll key changes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);

    async function renderHarness(scrollKey: string, scrollTop: number): Promise<HTMLDivElement> {
      await act(async () => {
        root.render(createElement(AutoScrollHarness, {
          metrics: {
            scrollTop,
            scrollHeight: 1_000,
            clientHeight: 400,
          },
          scrollKey,
        }));
        await Promise.resolve();
      });

      const scroller = host.querySelector('[data-testid="auto-scroll-harness"]') as HTMLDivElement | null;
      expect(scroller).not.toBeNull();
      if (scroller === null) {
        throw new Error("Expected auto-scroll harness scroller");
      }

      return scroller;
    }

    try {
      const firstScroller = await renderHarness("session-key-a", 600);
      await finishProgrammaticScrollSuppression();
      await detachMessagesScroller(firstScroller, 320);

      const secondScroller = await renderHarness("session-key-b", 600);
      expect(secondScroller.scrollTop).toBe(1_000);

      const restoredFirstScroller = await renderHarness("session-key-a", 600);
      expect(restoredFirstScroller.scrollTop).toBe(320);
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      host.remove();
    }
  });

  it("preserves detached scroll anchor when hydration replaces the visible snapshot", async () => {
    const sessionId = "session-scroll-snapshot";
    const freshTimestamp = Date.now();
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    getChatSnapshotMock.mockImplementation(() => new Promise((resolve) => {
      resolveHydrationSnapshot = resolve;
    }));
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      conversation: {
        updatedAt: freshTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Warm question" }],
            timestamp: freshTimestamp,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Warm answer" }],
            timestamp: freshTimestamp + 1,
            isError: false,
            isStopped: false,
          },
        ],
      },
    }), false);

    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_000,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();

    const scroller = queryMessagesScroller(getContainer());
    await finishProgrammaticScrollSuppression();
    await detachMessagesScroller(scroller, 300);
    setMessagesScrollerMetrics({
      scrollTop: scroller.scrollTop,
      scrollHeight: 1_300,
      clientHeight: 400,
    });
    configureMessagesScroller(scroller, {
      scrollTop: scroller.scrollTop,
      scrollHeight: 1_300,
      clientHeight: 400,
    });

    expect(resolveHydrationSnapshot).not.toBeNull();
    if (resolveHydrationSnapshot === null) {
      throw new Error("Expected pending hydration snapshot request");
    }

    await act(async () => {
      resolveHydrationSnapshot(createChatSnapshot({
        sessionId,
        conversationScopeId: sessionId,
        conversation: {
          updatedAt: freshTimestamp + 2,
          mainContentInvalidationVersion: 0,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Warm question" }],
              timestamp: freshTimestamp,
              isError: false,
              isStopped: false,
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Warm answer with refreshed details" }],
              timestamp: freshTimestamp + 1,
              isError: false,
              isStopped: false,
            },
          ],
        },
      }));
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    expect(scroller.scrollTop).toBe(600);
  });

  it("keeps detached scroll fixed when a fresh-object snapshot only appends messages", async () => {
    const sessionId = "session-scroll-append-snapshot";
    const freshTimestamp = Date.now();
    let resolveHydrationSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    getChatSnapshotMock.mockImplementation(() => new Promise((resolve) => {
      resolveHydrationSnapshot = resolve;
    }));
    storeChatSessionWarmStartSnapshot("workspace-1", createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      conversation: {
        updatedAt: freshTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Warm question" }],
            timestamp: freshTimestamp,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Warm answer" }],
            timestamp: freshTimestamp + 1,
            isError: false,
            isStopped: false,
          },
        ],
      },
    }), false);

    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_000,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();

    const scroller = queryMessagesScroller(getContainer());
    await finishProgrammaticScrollSuppression();
    await detachMessagesScroller(scroller, 300);
    setMessagesScrollerMetrics({
      scrollTop: scroller.scrollTop,
      scrollHeight: 1_300,
      clientHeight: 400,
    });
    configureMessagesScroller(scroller, {
      scrollTop: scroller.scrollTop,
      scrollHeight: 1_300,
      clientHeight: 400,
    });

    expect(resolveHydrationSnapshot).not.toBeNull();
    if (resolveHydrationSnapshot === null) {
      throw new Error("Expected pending hydration snapshot request");
    }

    await act(async () => {
      resolveHydrationSnapshot(createChatSnapshot({
        sessionId,
        conversationScopeId: sessionId,
        conversation: {
          updatedAt: freshTimestamp + 2,
          mainContentInvalidationVersion: 0,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Warm question" }],
              timestamp: freshTimestamp,
              isError: false,
              isStopped: false,
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Warm answer" }],
              timestamp: freshTimestamp + 1,
              isError: false,
              isStopped: false,
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Appended answer detail" }],
              timestamp: freshTimestamp + 2,
              isError: false,
              isStopped: false,
            },
          ],
        },
      }));
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    expect(scroller.scrollTop).toBe(300);
  });

  it("keeps detached scroll fixed while an active stream advances the assistant cursor", async () => {
    const sessionId = "session-streaming-detached";
    const freshTimestamp = Date.now();
    let emitLiveEvent: ((event: ChatLiveEvent) => void) | null = null;
    consumeChatLiveStreamMock.mockImplementation((params: Readonly<{
      onEvent: (event: ChatLiveEvent) => void;
    }>) => {
      emitLiveEvent = params.onEvent;
      return new Promise(() => undefined);
    });
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      activeRun: createChatActiveRun(),
      conversation: {
        updatedAt: freshTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Streaming question" }],
            timestamp: freshTimestamp,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Streaming answer" }],
            timestamp: freshTimestamp + 1,
            isError: false,
            isStopped: false,
            cursor: "cursor-0",
            itemId: "item-1",
          },
        ],
      },
    }));

    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_000,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const scroller = queryMessagesScroller(getContainer());
    await finishProgrammaticScrollSuppression();
    await detachMessagesScroller(scroller, 300);
    setMessagesScrollerMetrics({
      scrollTop: scroller.scrollTop,
      scrollHeight: 1_300,
      clientHeight: 400,
    });
    configureMessagesScroller(scroller, {
      scrollTop: scroller.scrollTop,
      scrollHeight: 1_300,
      clientHeight: 400,
    });

    expect(emitLiveEvent).not.toBeNull();
    if (emitLiveEvent === null) {
      throw new Error("Expected active chat live stream");
    }

    await act(async () => {
      emitLiveEvent({
        type: "assistant_delta",
        sessionId,
        conversationScopeId: sessionId,
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        text: " with more content",
        cursor: "cursor-1",
        itemId: "item-1",
      });
      await Promise.resolve();
    });
    await flushAsync();

    expect(scroller.scrollTop).toBe(300);
  });

  it("keeps bottom follow when a streaming session remounts before pending scroll flushes", async () => {
    const sessionId = "session-streaming-remount";
    const freshTimestamp = Date.now();
    let emitLiveEvent: ((event: ChatLiveEvent) => void) | null = null;
    consumeChatLiveStreamMock.mockImplementation((params: Readonly<{
      onEvent: (event: ChatLiveEvent) => void;
    }>) => {
      emitLiveEvent = params.onEvent;
      return new Promise(() => undefined);
    });
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      activeRun: createChatActiveRun(),
      conversation: {
        updatedAt: freshTimestamp,
        mainContentInvalidationVersion: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Streaming question" }],
            timestamp: freshTimestamp,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Streaming answer" }],
            timestamp: freshTimestamp + 1,
            isError: false,
            isStopped: false,
            cursor: "cursor-0",
            itemId: "item-1",
          },
        ],
      },
    }));

    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_000,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const scroller = queryMessagesScroller(getContainer());
    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_300,
      clientHeight: 400,
    });
    configureMessagesScroller(scroller, {
      scrollTop: 600,
      scrollHeight: 1_300,
      clientHeight: 400,
    });

    expect(emitLiveEvent).not.toBeNull();
    if (emitLiveEvent === null) {
      throw new Error("Expected active chat live stream");
    }

    await act(async () => {
      emitLiveEvent({
        type: "assistant_delta",
        sessionId,
        conversationScopeId: sessionId,
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        text: " with more content",
        cursor: "cursor-1",
        itemId: "item-1",
      });
      await Promise.resolve();
    });
    await flushAsync();

    expect(scroller.scrollTop).toBe(600);

    await hideChatPanel();
    setMessagesScrollerMetrics({
      scrollTop: 600,
      scrollHeight: 1_300,
      clientHeight: 400,
    });
    await renderChatPanel();
    await flushAsync();

    const remountedScroller = queryMessagesScroller(getContainer());
    expect(remountedScroller.scrollTop).toBe(1_300);
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
