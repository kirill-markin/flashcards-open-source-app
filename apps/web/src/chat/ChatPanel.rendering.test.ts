import { describe, expect, it, vi } from "vitest";
import {
  createChatSnapshot,
  getChatSnapshotMock,
  resetChatSessionMock,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  stopChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel backend-owned flow", () => {
  it("bootstraps transcript from the backend snapshot", async () => {
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot({
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Persisted answer" }],
        timestamp: 10,
        isError: false,
        isStopped: false,
      }],
    }));

    await chatPanel.renderChatPanel();

    expect(getChatSnapshotMock).toHaveBeenCalledWith(undefined);
    expect(chatPanel.getContainer().textContent).toContain("Persisted answer");
  });

  it("sends the compact backend-owned request body", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        runState: "running",
        updatedAt: 2,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
            timestamp: 11,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Looking through your cards..." }],
            timestamp: 12,
            isError: false,
            isStopped: false,
          },
        ],
      }));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("hello");

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual({
      sessionId: "session-1",
      content: [{ type: "text", text: "hello" }],
      timezone: expect.any(String),
    });
    expect(getChatSnapshotMock).toHaveBeenLastCalledWith("session-1");
  });

  it("stops an active run through the backend stop endpoint", async () => {
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot({
      runState: "running",
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Still running" }],
        timestamp: 10,
        isError: false,
        isStopped: false,
      }],
    }));

    await chatPanel.renderChatPanel();
    await chatPanel.clickStop();

    expect(stopChatRunMock).toHaveBeenCalledWith("session-1");
  });

  it("starts a fresh conversation through the backend reset endpoint", async () => {
    await chatPanel.renderChatPanel();
    await chatPanel.clickNewConversation();

    expect(resetChatSessionMock).toHaveBeenCalledWith("session-1");
  });

  it("refreshes app data when the backend invalidates main content", async () => {
    const refreshLocalDataMock = vi.fn(async (): Promise<void> => undefined);
    useAppDataMock.mockReturnValue({
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: refreshLocalDataMock,
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot({
        mainContentInvalidationVersion: 0,
      }))
      .mockResolvedValueOnce(createChatSnapshot({
        runState: "running",
        updatedAt: 2,
        mainContentInvalidationVersion: 1,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
            timestamp: 11,
            isError: false,
            isStopped: false,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Done" }],
            timestamp: 12,
            isError: false,
            isStopped: false,
          },
        ],
      }));

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("hello");

    expect(refreshLocalDataMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the unsent draft across chat panel remounts in the same workspace", async () => {
    await chatPanel.renderChatPanel("fullscreen");

    const fullscreenTextarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]');
    expect(fullscreenTextarea).not.toBeNull();

    setTextareaValue(fullscreenTextarea as HTMLTextAreaElement, "draft survives remount");

    await chatPanel.renderChatPanel("sidebar");

    const sidebarTextarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]');
    expect(sidebarTextarea).not.toBeNull();
    expect((sidebarTextarea as HTMLTextAreaElement).value).toBe("draft survives remount");
  });

  it("preserves pending attachments across chat panel remounts in the same workspace", async () => {
    await chatPanel.renderChatPanel("fullscreen");
    await chatPanel.clickAddAttachment();

    expect(chatPanel.getContainer().textContent).toContain("attached.txt");

    await chatPanel.renderChatPanel("sidebar");

    expect(chatPanel.getContainer().textContent).toContain("attached.txt");
  });

  it("clears the draft when the active workspace changes", async () => {
    await chatPanel.renderChatPanel("fullscreen");

    const fullscreenTextarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]');
    expect(fullscreenTextarea).not.toBeNull();
    setTextareaValue(fullscreenTextarea as HTMLTextAreaElement, "workspace-bound draft");
    await chatPanel.clickAddAttachment();

    useAppDataMock.mockReturnValue({
      activeWorkspace: {
        workspaceId: "workspace-2",
        name: "Secondary",
        createdAt: "2026-03-11T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

    await chatPanel.renderChatPanel("sidebar");

    const sidebarTextarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]');
    expect(sidebarTextarea).not.toBeNull();
    expect((sidebarTextarea as HTMLTextAreaElement).value).toBe("");
    expect(chatPanel.getContainer().textContent).not.toContain("attached.txt");
  });

  it("clears the draft when the user starts a new conversation", async () => {
    await chatPanel.renderChatPanel("fullscreen");

    const textarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    setTextareaValue(textarea as HTMLTextAreaElement, "clear me");
    await chatPanel.clickAddAttachment();

    await chatPanel.clickNewConversation();

    const refreshedTextarea = chatPanel.getContainer().querySelector('textarea[name="chatMessage"]');
    expect(refreshedTextarea).not.toBeNull();
    expect((refreshedTextarea as HTMLTextAreaElement).value).toBe("");
    expect(chatPanel.getContainer().textContent).not.toContain("attached.txt");
  });
});
