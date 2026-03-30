// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  setupChatPanelTest,
  useAppDataMock,
} from "./ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  clickNewConversation,
} = setupChatPanelTest();

describe("ChatPanel new chat", () => {
  it("clears the conversation after a successful new-session response", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Existing response" }],
        timestamp: 1,
        isError: false,
        isStopped: false,
      }],
    }));

    await renderChatPanel();
    await clickNewConversation();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledWith("session-1");
    expect(getContainer().querySelectorAll(".chat-msg").length).toBe(0);
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("keeps the conversation and reports a top-level error when new-session fails", async () => {
    const setErrorMessage = vi.fn();
    useAppDataMock.mockReturnValue({
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage,
    });
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Existing response" }],
        timestamp: 1,
        isError: false,
        isStopped: false,
      }],
    }));
    createNewChatSessionMock.mockRejectedValue(new Error("Request failed with status 500"));

    await renderChatPanel();
    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledWith("session-1");
    expect(getContainer().querySelectorAll(".chat-msg").length).toBe(1);
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(setErrorMessage).toHaveBeenCalledWith("New chat failed. Request failed with status 500");
  });
});
