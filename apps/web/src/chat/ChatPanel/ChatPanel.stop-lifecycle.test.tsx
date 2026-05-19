// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ApiErrorMock,
  captureWebExceptionMock,
  createChatActiveRun,
  createChatSnapshot,
  getChatSnapshotMock,
  queryChatComposerState,
  queryChatSendButton,
  queryChatStopButton,
  setupChatPanelTest,
  stopChatRunMock,
} from "./ChatPanelTestSupport";

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

    expect(stopChatRunMock.mock.calls[1]).toEqual(["session-1", "workspace-1", null]);

    resolveReconcileSnapshot?.(createChatSnapshot({
      activeRun: createChatActiveRun({ runId: "run-2" }),
    }));
    await flushAsync();
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
