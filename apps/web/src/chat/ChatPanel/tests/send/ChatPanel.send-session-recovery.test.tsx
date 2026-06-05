// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createChatSessionIdConflictError,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  queryChatComposerInput,
  readStoredDraftInputText,
  setupChatPanelTest,
  startChatRunMock,
} from "../support/ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel send session recovery", () => {
  it("recovers from a stale session id conflict while provisioning the first remote session", async () => {
    createNewChatSessionMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Chat refresh failed.");

    await sendMessage("hello after stale session");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const recoveredSessionId = createNewChatSessionMock.mock.calls[2]?.[0];
    const textarea = queryChatComposerInput(getContainer());
    expect(typeof staleSessionId).toBe("string");
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
    expect(textarea?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("Requested chat session id is already in use.");
  });

  it("recovers from a stale session id conflict while starting a chat run", async () => {
    startChatRunMock.mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await sendMessage("hello after start conflict");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const textarea = queryChatComposerInput(getContainer());
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    const initialStartRunRequest = startChatRunMock.mock.calls[0]?.[0];
    const retryStartRunRequest = startChatRunMock.mock.calls[1]?.[0];
    expect(initialStartRunRequest).toEqual(expect.objectContaining({
      sessionId: staleSessionId,
    }));
    expect(retryStartRunRequest).toEqual(expect.objectContaining({
      sessionId: recoveredSessionId,
    }));
    if (initialStartRunRequest === undefined || retryStartRunRequest === undefined) {
      throw new Error("Expected chat run requests");
    }
    expect({
      ...retryStartRunRequest,
      sessionId: initialStartRunRequest.sessionId,
    }).toEqual(initialStartRunRequest);
    expect(textarea?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("Requested chat session id is already in use.");
  });

  it("does not recover more than once when the retry also hits a session id conflict", async () => {
    startChatRunMock
      .mockRejectedValueOnce(createChatSessionIdConflictError())
      .mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const staleSessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof staleSessionId).toBe("string");

    await sendMessage("retry conflict should stop");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const recoveredSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    const textarea = queryChatComposerInput(getContainer());
    expect(typeof recoveredSessionId).toBe("string");
    expect(recoveredSessionId).not.toBe(staleSessionId);
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    expect(textarea?.value).toBe("retry conflict should stop");
    expect(readStoredDraftInputText("workspace-1", staleSessionId as string)).toBeNull();
    expect(readStoredDraftInputText("workspace-1", recoveredSessionId as string)).toBe("retry conflict should stop");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(getContainer().textContent).toContain("Requested chat session id is already in use.");
  });

  it("does not recover from a session id conflict when the local conversation is not empty", async () => {
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Existing response" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
          cursor: null,
          itemId: null,
        }],
      },
    }));
    startChatRunMock.mockRejectedValueOnce(createChatSessionIdConflictError());

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Existing response");

    await sendMessage("keep this draft");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("keep this draft");
    expect(getContainer().textContent).toContain("Existing response");
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
    expect(getContainer().textContent).toContain("Requested chat session id is already in use.");
  });
});
