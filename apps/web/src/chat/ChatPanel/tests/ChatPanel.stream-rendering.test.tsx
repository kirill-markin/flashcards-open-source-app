// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ChatLiveContractErrorMock,
  ChatLiveHttpErrorMock,
  ChatLiveTransportErrorMock,
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  getChatSnapshotMock,
  setupChatPanelTest,
} from "./support/ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

function createRecoverableTransportError(): InstanceType<typeof ChatLiveTransportErrorMock> {
  return new ChatLiveTransportErrorMock(
    "AI live stream transport failed: browser stream interrupted",
    {
      requestId: "request-transport-1",
      statusCode: 200,
      code: null,
    },
    "TypeError",
    new TypeError("browser stream interrupted"),
  );
}

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

  it("recovers a live transport error with a terminal snapshot without opening an error dialog", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        activeRun: null,
        conversation: {
          updatedAt: 2,
          mainContentInvalidationVersion: 0,
          messages: [{
            role: "assistant",
            content: [{ type: "text", text: "Recovered terminal response" }],
            timestamp: 2,
            isError: false,
            isStopped: false,
          }],
        },
      }));
    consumeChatLiveStreamMock.mockRejectedValueOnce(createRecoverableTransportError());

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(1);
    expect(getContainer().textContent).toContain("Recovered terminal response");
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
  });

  it("recovers a live transport error with a replacement live stream when the snapshot is still running", async () => {
    const replacementActiveRun = createChatActiveRun({
      runId: "run-resumed",
      live: {
        cursor: "cursor-resume",
        stream: {
          url: "https://chat-live.example.com/resumed",
          authorization: "Live resumed-token",
          expiresAt: Date.now() + 60_000,
        },
      },
    });
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValueOnce(createChatSnapshot({
        sessionId: "session-1",
        activeRun: replacementActiveRun,
      }));
    consumeChatLiveStreamMock
      .mockRejectedValueOnce(createRecoverableTransportError())
      .mockImplementationOnce(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(2);
    const replacementStreamParams = consumeChatLiveStreamMock.mock.calls[1]?.[0] as Readonly<{
      runId: string;
      afterCursor: string | null;
      resumeAttemptId: number | null;
    }> | undefined;
    expect(replacementStreamParams?.runId).toBe("run-resumed");
    expect(replacementStreamParams?.afterCursor).toBe("cursor-resume");
    expect(replacementStreamParams?.resumeAttemptId).not.toBeNull();
    expect(getChatSnapshotMock.mock.calls[1]?.[2]).toEqual({
      resumeAttemptId: replacementStreamParams?.resumeAttemptId,
    });
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps non-transport live errors on the hard-failure path", async () => {
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot());
    consumeChatLiveStreamMock.mockRejectedValueOnce(new TypeError("network changed"));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("network changed");
  });

  it.each([
    [
      "HTTP",
      () => new ChatLiveHttpErrorMock(
        "AI live stream failed with status 503: upstream unavailable",
        503,
        "request-http-1",
        "UPSTREAM_UNAVAILABLE",
      ),
    ],
    [
      "contract",
      () => new ChatLiveContractErrorMock(
        "AI live stream event is invalid: cursor must be a string.",
        "assistant_delta",
        "{\"type\":\"assistant_delta\"}",
      ),
    ],
  ])("keeps %s live errors on the hard-failure path", async (_errorKind, createError) => {
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot());
    consumeChatLiveStreamMock.mockRejectedValueOnce(createError());

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
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

  it("does not open an error dialog when assistant_message_done is followed by stream close", async () => {
    consumeChatLiveStreamMock.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "assistant_delta",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 1,
        streamEpoch: "epoch-1",
        text: "All set.",
        cursor: "cursor-1",
        itemId: "item-1",
      });
      onEvent({
        type: "assistant_message_done",
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: "run-1",
        sequenceNumber: 2,
        streamEpoch: "epoch-1",
        cursor: "cursor-1",
        itemId: "item-1",
        content: [{ type: "text", text: "All set." }],
        isError: false,
        isStopped: false,
      });
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await flushAsync();

    expect(getChatSnapshotMock).toHaveBeenCalled();
    expect(getContainer().querySelector(".chat-msg-error")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    expect(getContainer().textContent).not.toContain("AI live stream ended before the run finished.");
  });
});
