// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  captureWebExceptionMock,
  createChatActiveRun,
  createChatSessionIdConflictError,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  queryChatComposerInput,
  setupChatPanelTest,
  startChatRunMock,
} from "./support/ChatPanelTestSupport";
import { storeChatSessionWarmStartSnapshot } from "../../sessionController/warmStart";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel send warm-start races", () => {
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
});
