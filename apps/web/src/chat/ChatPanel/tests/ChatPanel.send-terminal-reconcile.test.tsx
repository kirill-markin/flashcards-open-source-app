// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ApiErrorMock,
  createChatActiveRun,
  createChatSessionIdConflictError,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  queryChatComposerInput,
  queryChatStopButton,
  setupChatPanelTest,
  startChatRunMock,
} from "./support/ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel send terminal reconcile", () => {
  it("ignores a stale terminal reconcile after a newer run starts in the same session", async () => {
    let resolveTerminalReconcile: (() => void) | null = null;
    startChatRunMock
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          conversation: {
            updatedAt: 1,
            mainContentInvalidationVersion: 0,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "first terminal send" }],
                timestamp: 1,
                isError: false,
                isStopped: false,
                cursor: null,
                itemId: null,
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "Accepted terminal answer" }],
                timestamp: 2,
                isError: false,
                isStopped: false,
                cursor: null,
                itemId: null,
              },
            ],
          },
          activeRun: null,
        }),
        accepted: true,
      }))
      .mockImplementationOnce(async (requestBody) => ({
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

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");
    getChatSnapshotMock.mockImplementationOnce((snapshotSessionId: string) => new Promise((resolve) => {
      expect(snapshotSessionId).toBe(sessionId);
      resolveTerminalReconcile = () => resolve(createChatSnapshot({
        sessionId: snapshotSessionId,
        conversationScopeId: snapshotSessionId,
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{ type: "text", text: "Late terminal reconcile" }],
            timestamp: 2,
            isError: false,
            isStopped: false,
            cursor: null,
            itemId: null,
          }],
        },
        activeRun: null,
      }));
    }));

    await sendMessage("first terminal send");
    await flushAsync();
    await flushAsync();
    expect(getContainer().textContent).toContain("Accepted terminal answer");

    await sendMessage("second active run");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(queryChatStopButton(getContainer())).not.toBeNull();

    resolveTerminalReconcile?.();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("second active run");
    expect(getContainer().textContent).toContain("Accepted terminal answer");
    expect(getContainer().textContent).not.toContain("Late terminal reconcile");
    expect(queryChatStopButton(getContainer())).not.toBeNull();
  });

  it("keeps a pending terminal reconcile when the next send is rejected before acceptance", async () => {
    let resolveTerminalReconcile: (() => void) | null = null;
    startChatRunMock
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          activeRun: null,
        }),
        accepted: true,
      }))
      .mockRejectedValueOnce(new ApiErrorMock(500, "Request failed with status 500", "INTERNAL_ERROR"));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");
    getChatSnapshotMock.mockImplementationOnce((snapshotSessionId: string) => new Promise((resolve) => {
      expect(snapshotSessionId).toBe(sessionId);
      resolveTerminalReconcile = () => resolve(createChatSnapshot({
        sessionId: snapshotSessionId,
        conversationScopeId: snapshotSessionId,
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{ type: "text", text: "Terminal reconcile applied" }],
            timestamp: 2,
            isError: false,
            isStopped: false,
            cursor: null,
            itemId: null,
          }],
        },
        activeRun: null,
      }));
    }));

    await sendMessage("first terminal send");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledWith(sessionId, "workspace-1");

    await sendMessage("second send rejected before acceptance");
    await flushAsync();
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(getContainer().textContent).not.toContain("Terminal reconcile applied");

    resolveTerminalReconcile?.();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Terminal reconcile applied");
    expect(queryChatComposerInput(getContainer())?.value).toBe("second send rejected before acceptance");
  });

  it("reconciles a terminal recovered send with the recovered session id", async () => {
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockImplementationOnce(async (requestBody) => ({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
        }),
        accepted: true,
      }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const snapshotCallsBeforeSend = getChatSnapshotMock.mock.calls.length;

    await sendMessage("terminal recovered send");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const lastSnapshotCall = getChatSnapshotMock.mock.calls[getChatSnapshotMock.mock.calls.length - 1];
    expect(typeof recoveredSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(getChatSnapshotMock.mock.calls.length).toBeGreaterThan(snapshotCallsBeforeSend);
    expect(lastSnapshotCall?.[0]).toBe(recoveredSessionId);
  });
});
