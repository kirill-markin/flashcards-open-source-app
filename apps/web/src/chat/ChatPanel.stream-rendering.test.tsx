// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  getChatSnapshotMock,
  setupChatPanelTest,
} from "./ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel stream rendering", () => {
  it("reconciles a clean unexpected EOF without opening an error dialog", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        activeRun: null,
      }));
    consumeChatLiveStreamMock.mockResolvedValue(undefined);

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("opens an error dialog when unexpected EOF still reconciles to a running run", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        activeRun: createChatActiveRun(),
      }));
    consumeChatLiveStreamMock.mockResolvedValue(undefined);

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("AI live stream ended before the run finished.");
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("ignores duplicate visible visibilitychange events while the live stream is already connected", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    consumeChatLiveStreamMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();
    document.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("renders completed reasoning summaries with the completed tool-call styling", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      sessionId: "session-1",
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [{
          role: "assistant",
          content: [{ type: "reasoning_summary", summary: "Compared due cards and queued a search.", status: "completed" }],
          timestamp: 1,
          isError: false,
          isStopped: false,
        }],
      },
    }));

    await renderChatPanel();
    await flushAsync();

    expect(getContainer().querySelector(".chat-tool-call-completed")).not.toBeNull();
    expect(getContainer().querySelector(".chat-tool-call-started")).toBeNull();
    expect(getContainer().textContent).toContain("Reasoning");
    expect(getContainer().textContent).toContain("Done");
  });
});
