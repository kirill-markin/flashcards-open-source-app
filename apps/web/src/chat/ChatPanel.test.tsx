// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ApiErrorMock,
  createChatSnapshot,
  createNewChatSessionMock,
  getChatSnapshotMock,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  clickNewConversation,
  sendMessage,
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

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
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
    await flushAsync();
    await clickNewConversation();
    await flushAsync();
    await flushAsync();

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(setErrorMessage).toHaveBeenCalledWith("New chat failed. Request failed with status 500");
  });
});

describe("ChatPanel send lifecycle", () => {
  it("shows loading UI instead of empty suggestions while the initial chat history is unresolved", async () => {
    getChatSnapshotMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();

    expect(getContainer().textContent).toContain("Loading AI chat");
    expect(getContainer().textContent).not.toContain("Try asking:");
  });

  it("preserves the visible transcript while the session is revalidating", async () => {
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
    await flushAsync();

    useAppDataMock.mockReturnValue({
      sessionVerificationState: "unverified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: false,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();

    expect(getContainer().textContent).toContain("Existing response");
    expect(getContainer().textContent).toContain("Restoring session...");
    expect(getContainer().textContent).not.toContain("Try asking:");
  });

  it("shows a disabled send button until the draft has text or attachments", async () => {
    await renderChatPanel();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    const sendButton = getContainer().querySelector('.chat-send-btn[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(textarea).not.toBeNull();
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);

    await setTextareaValue(textarea as HTMLTextAreaElement, "hello");
    await flushAsync();

    expect(sendButton?.disabled).toBe(false);
  });

  it("does not fetch remote chat history until the browser session is verified", async () => {
    useAppDataMock.mockReturnValue({
      sessionVerificationState: "unverified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: false,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });

    await renderChatPanel();
    await flushAsync();

    expect(getChatSnapshotMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).toContain("Restoring session...");
  });

  it("sends only one POST /chat while async preflight is in progress", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ok: true,
        sessionId: "session-1",
        runId: "run-1",
        clientRequestId: "client-request-1",
        runState: "running",
        liveStream: {
          url: "https://chat-live.example.com",
          authorization: "Live mock-token",
          expiresAt: Date.now() + 60_000,
        },
        chatConfig: createChatSnapshot().chatConfig,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await sendMessage("hello");
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("shows stop while the assistant run is active and returns to send afterward", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValue(createChatSnapshot({
        sessionId: "session-1",
        runState: "running",
        liveStream: {
          url: "https://chat-live.example.com",
          authorization: "Live mock-token",
          expiresAt: Date.now() + 60_000,
        },
      }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    const stopButton = getContainer().querySelector('.chat-stop-btn[aria-label="Stop response"]') as HTMLButtonElement | null;
    const sendButton = getContainer().querySelector('.chat-send-btn[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(false);
    expect(sendButton).toBeNull();
  });

  it("disables starting a new chat while turn acceptance is still in flight", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ok: true,
        sessionId: "session-1",
        runId: "run-1",
        clientRequestId: "client-request-1",
        runState: "running",
        liveStream: {
          url: "https://chat-live.example.com",
          authorization: "Live mock-token",
          expiresAt: Date.now() + 60_000,
        },
        chatConfig: createChatSnapshot().chatConfig,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    const newButton = [...getContainer().querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "New");
    expect(newButton).not.toBeUndefined();
    expect((newButton as HTMLButtonElement).disabled).toBe(true);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("keeps the draft when startRun fails before the server accepts the turn", async () => {
    startChatRunMock.mockRejectedValue(new Error("Request failed with status 500"));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("keep this draft");
    await flushAsync();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("keep this draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("treats active-run conflicts as a non-destructive composer notice", async () => {
    startChatRunMock.mockRejectedValue(new ApiErrorMock(
      409,
      "Chat session already has an active response",
      "CHAT_ACTIVE_RUN_IN_PROGRESS",
    ));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("second turn");
    await flushAsync();
    await flushAsync();

    const textarea = getContainer().querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("second turn");
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(getContainer().textContent).toContain("A response is already in progress.");
  });

  it("renders completed reasoning summaries with the completed tool-call styling", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      messages: [{
        role: "assistant",
        content: [{ type: "reasoning_summary", summary: "Compared due cards and queued a search." }],
        timestamp: 1,
        isError: false,
        isStopped: false,
      }],
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getContainer().querySelector(".chat-tool-call-completed")).not.toBeNull();
    expect(getContainer().querySelector(".chat-tool-call-started")).toBeNull();
    expect(getContainer().textContent).toContain("Reasoning");
    expect(getContainer().textContent).toContain("Done");
  });
});
