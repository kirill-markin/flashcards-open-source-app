// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ApiErrorMock,
  captureWebExceptionMock,
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  getChatSnapshotMock,
  queryChatComposerState,
  queryChatSendButton,
  queryChatStopButton,
  setupChatPanelTest,
  startChatRunMock,
  stopChatRunMock,
  useAppDataMock,
} from "../support/ChatPanelTestSupport";
import { createVerifiedWorkspaceAppDataMock } from "../support/ChatPanelTestFixtures";

const {
  clickStop,
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel stop lifecycle", () => {
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

    const stopButton = queryChatStopButton(getContainer());
    const sendButton = queryChatSendButton(getContainer());
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(false);
    expect(sendButton).toBeNull();
  });

  it("passes the accepted active run id when stopping a sent message", async () => {
    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();

    expect(stopChatRunMock).toHaveBeenCalledWith(expect.any(String), "workspace-1", "run-1");
  });

  it("returns to send after an immediate stop when no live stream is attached", async () => {
    let currentVisibilityState: DocumentVisibilityState = "hidden";
    let resolveReconcileSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => currentVisibilityState,
    });
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        activeRun: createChatActiveRun(),
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReconcileSnapshot = resolve;
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(queryChatStopButton(getContainer())).not.toBeNull();

    await clickStop();
    await flushAsync();
    await flushAsync();

    expect(stopChatRunMock).toHaveBeenCalledWith("session-1", "workspace-1", "run-1");
    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("false");
    expect(queryChatStopButton(getContainer())).toBeNull();
    expect(queryChatSendButton(getContainer())).not.toBeNull();

    currentVisibilityState = "visible";
    resolveReconcileSnapshot?.(createChatSnapshot({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      activeRun: null,
    }));
    await flushAsync();
  });

  it("clears stopping and reconciles the snapshot when stop returns a no-op", async () => {
    let resolveReconcileSnapshot: ((snapshot: ReturnType<typeof createChatSnapshot>) => void) | null = null;
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot({
        activeRun: createChatActiveRun(),
      }))
      .mockImplementation(() => new Promise((resolve) => {
        resolveReconcileSnapshot = resolve;
      }));
    stopChatRunMock.mockResolvedValue({
      sessionId: "session-1",
      stopped: false,
      stillRunning: true,
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();
    await flushAsync();

    const composerState = queryChatComposerState(getContainer());
    const stopButton = queryChatStopButton(getContainer());
    expect(stopChatRunMock).toHaveBeenCalledWith("session-1", "workspace-1", "run-1");
    expect(getChatSnapshotMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(composerState?.getAttribute("data-stopping")).toBe("false");
    expect(composerState?.getAttribute("data-composer-state")).toBe("running");
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(false);

    await clickStop();
    await flushAsync();

    expect(stopChatRunMock.mock.calls[1]).toEqual(["session-1", "workspace-1", "run-1"]);

    resolveReconcileSnapshot?.(createChatSnapshot({
      activeRun: createChatActiveRun({ runId: "run-2" }),
    }));
    await flushAsync();
  });

  it("ignores stop completion after switching workspaces", async () => {
    let resolveStopRun: (() => void) | null = null;
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      activeRun: createChatActiveRun(),
    }));
    stopChatRunMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStopRun = () => resolve({
        sessionId: "session-1",
        stopped: false,
        stillRunning: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
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

    const snapshotCallsBeforeStop = getChatSnapshotMock.mock.calls.length;

    resolveStopRun?.();
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock.mock.calls.length).toBe(snapshotCallsBeforeStop);
    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("false");
    expect(queryChatStopButton(getContainer())).toBeNull();
    expect(queryChatSendButton(getContainer())).not.toBeNull();
    expect(getContainer().textContent).not.toContain("Chat stop failed.");
    expect(captureWebExceptionMock).not.toHaveBeenCalled();
  });

  it("ignores stop failure after switching workspaces", async () => {
    let rejectStopRun: ((error: Error) => void) | null = null;
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      activeRun: createChatActiveRun(),
    }));
    stopChatRunMock.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectStopRun = (error) => reject(error);
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
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

    const snapshotCallsBeforeStop = getChatSnapshotMock.mock.calls.length;

    rejectStopRun?.(new ApiErrorMock(500, "Request failed. Try again.", "INTERNAL_ERROR"));
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock.mock.calls.length).toBe(snapshotCallsBeforeStop);
    expect(captureWebExceptionMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).not.toContain("Chat stop failed.");
  });

  it("ignores stop completion after a newer run starts in the same session", async () => {
    let releaseRunTerminal: (() => void) | null = null;
    let resolveStopRun: (() => void) | null = null;
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      activeRun: createChatActiveRun({ runId: "run-1" }),
    }));
    consumeChatLiveStreamMock.mockImplementation(({ onEvent, runId, sessionId }) => {
      if (runId !== "run-1") {
        return new Promise(() => undefined);
      }

      return new Promise<void>((resolve) => {
        releaseRunTerminal = () => {
          onEvent({
            type: "run_terminal",
            sessionId,
            conversationScopeId: sessionId,
            runId,
            sequenceNumber: 1,
            streamEpoch: "epoch-1",
            cursor: null,
            outcome: "completed",
          });
          resolve();
        };
      });
    });
    stopChatRunMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStopRun = () => resolve({
        sessionId: "session-1",
        stopped: false,
        stillRunning: true,
      });
    }));
    startChatRunMock.mockImplementationOnce(async (requestBody) => ({
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

    await clickStop();
    await flushAsync();

    releaseRunTerminal?.();
    await flushAsync();
    await flushAsync();

    await sendMessage("new run after terminal");
    await flushAsync();
    await flushAsync();

    const snapshotCallsBeforeStop = getChatSnapshotMock.mock.calls.length;

    resolveStopRun?.();
    await flushAsync();
    await flushAsync();

    expect(stopChatRunMock).toHaveBeenCalledWith("session-1", "workspace-1", "run-1");
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock.mock.calls.length).toBe(snapshotCallsBeforeStop);
    expect(queryChatStopButton(getContainer())).not.toBeNull();
  });

  it("keeps a newer stop pending when an older stop completion arrives", async () => {
    let releaseRunTerminal: (() => void) | null = null;
    let resolveOldStopRun: (() => void) | null = null;
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      activeRun: createChatActiveRun({ runId: "run-1" }),
    }));
    consumeChatLiveStreamMock.mockImplementation(({ onEvent, runId, sessionId }) => {
      if (runId !== "run-1") {
        return new Promise(() => undefined);
      }

      return new Promise<void>((resolve) => {
        releaseRunTerminal = () => {
          onEvent({
            type: "run_terminal",
            sessionId,
            conversationScopeId: sessionId,
            runId,
            sequenceNumber: 1,
            streamEpoch: "epoch-1",
            cursor: null,
            outcome: "completed",
          });
          resolve();
        };
      });
    });
    stopChatRunMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOldStopRun = () => resolve({
          sessionId: "session-1",
          stopped: false,
          stillRunning: true,
        });
      }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    startChatRunMock.mockImplementationOnce(async (requestBody) => ({
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

    await clickStop();
    await flushAsync();

    releaseRunTerminal?.();
    await flushAsync();
    await flushAsync();

    await sendMessage("new run after terminal");
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();

    expect(stopChatRunMock.mock.calls[0]).toEqual(["session-1", "workspace-1", "run-1"]);
    expect(stopChatRunMock.mock.calls[1]).toEqual(["session-1", "workspace-1", "run-2"]);
    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("true");
    expect(queryChatStopButton(getContainer())?.disabled).toBe(true);

    resolveOldStopRun?.();
    await flushAsync();
    await flushAsync();

    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("true");
    expect(queryChatStopButton(getContainer())?.disabled).toBe(true);
  });

  it("clears stale stopping when a snapshot reports a newer active run", async () => {
    let currentVisibilityState: DocumentVisibilityState = "visible";
    let resolveStopRun: (() => void) | null = null;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => currentVisibilityState,
    });
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        activeRun: createChatActiveRun({ runId: "run-1" }),
      }))
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        activeRun: createChatActiveRun({ runId: "run-2" }),
      }));
    stopChatRunMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStopRun = () => resolve({
          sessionId: "session-1",
          stopped: false,
          stillRunning: true,
        });
      }))
      .mockImplementationOnce(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();

    const composerStateWhileStopping = queryChatComposerState(getContainer());
    expect(composerStateWhileStopping?.getAttribute("data-stopping")).toBe("true");

    currentVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    currentVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("false");

    const runTwoStopButton = queryChatStopButton(getContainer());
    expect(runTwoStopButton).not.toBeNull();
    expect(runTwoStopButton?.disabled).toBe(false);

    await clickStop();
    await flushAsync();

    expect(stopChatRunMock.mock.calls[1]).toEqual(["session-1", "workspace-1", "run-2"]);
    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("true");

    resolveStopRun?.();
    await flushAsync();
    await flushAsync();

    const stopButton = queryChatStopButton(getContainer());
    expect(stopChatRunMock).toHaveBeenCalledWith("session-1", "workspace-1", "run-1");
    expect(queryChatComposerState(getContainer())?.getAttribute("data-stopping")).toBe("true");
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(true);
  });

  it("captures unexpected stop failures with the stop chat operation", async () => {
    const stopError = new ApiErrorMock(500, "Request failed. Try again.", "INTERNAL_ERROR");
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      activeRun: createChatActiveRun(),
    }));
    stopChatRunMock.mockRejectedValue(stopError);

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();

    expect(captureWebExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).toHaveBeenCalledWith({
      action: "chat_run_request_failed",
      error: stopError,
      scope: {
        app: "web",
        feature: "chat",
        userId: null,
        workspaceId: "workspace-1",
        installationId: null,
        route: "/",
        requestId: null,
        statusCode: 500,
        code: "INTERNAL_ERROR",
      },
      details: {
        operation: "chat_stop_run_failed",
        sessionId: "session-1",
        workspaceId: "workspace-1",
      },
    });
    expect(getContainer().textContent).toContain("Chat stop failed.");
  });
});
