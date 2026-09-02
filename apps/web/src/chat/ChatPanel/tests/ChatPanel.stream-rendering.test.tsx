// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ChatLiveContractErrorMock,
  ChatLiveHttpErrorMock,
  ChatLiveTransportErrorMock,
  captureWebExceptionMock,
  consumeChatLiveStreamMock,
  createChatActiveRun,
  createChatSnapshot,
  getChatSnapshotMock,
  setupChatPanelTest,
  startChatRunMock,
} from "./support/ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
  unmountChatPanel,
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

function createRecoverableAttachThrottleError(
  retryAfterMs: number | null,
): InstanceType<typeof ChatLiveHttpErrorMock> {
  return new ChatLiveHttpErrorMock(
    "AI live stream failed with status 429: Too Many Requests",
    429,
    "request-throttle-1",
    null,
    retryAfterMs,
  );
}

async function advanceRecoveryDelay(delayMs: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(delayMs);
  });
  await flushAsync();
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

  it("recovers a code-less live attach throttle with a terminal authoritative snapshot", async () => {
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
            content: [{ type: "text", text: "Persisted response after throttled attach" }],
            timestamp: 2,
            isError: false,
            isStopped: false,
          }],
        },
      }));
    consumeChatLiveStreamMock.mockRejectedValueOnce(createRecoverableAttachThrottleError(10_000));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    await advanceRecoveryDelay(3_999);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);

    await advanceRecoveryDelay(1);

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(1);
    expect(getContainer().textContent).toContain("Persisted response after throttled attach");
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
  });

  it("reattaches a zero-delay throttled active run only after the scheduled backoff", async () => {
    const replacementActiveRun = createChatActiveRun({
      live: {
        cursor: "authoritative-cursor",
        stream: {
          url: "https://chat-live.example.com/authoritative",
          authorization: "Live authoritative-token",
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
      .mockRejectedValueOnce(createRecoverableAttachThrottleError(0))
      .mockImplementationOnce(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    await advanceRecoveryDelay(499);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);

    await advanceRecoveryDelay(1);

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(2);
    const replacementStreamParams = consumeChatLiveStreamMock.mock.calls[1]?.[0] as Readonly<{
      liveStream: {
        url: string;
        authorization: string;
      };
      runId: string;
      afterCursor: string | null;
      resumeAttemptId: number | null;
    }> | undefined;
    expect(replacementStreamParams).toMatchObject({
      liveStream: {
        url: "https://chat-live.example.com/authoritative",
        authorization: "Live authoritative-token",
      },
      runId: "run-1",
      afterCursor: "authoritative-cursor",
    });
    expect(replacementStreamParams?.resumeAttemptId).not.toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not let a Retry-After hint shorten a later scheduled backoff", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValue(createChatSnapshot({
        sessionId: "session-1",
        activeRun: createChatActiveRun(),
      }));
    consumeChatLiveStreamMock
      .mockRejectedValueOnce(createRecoverableAttachThrottleError(750))
      .mockRejectedValueOnce(createRecoverableAttachThrottleError(750))
      .mockImplementationOnce(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    await advanceRecoveryDelay(749);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);

    await advanceRecoveryDelay(1);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(2);

    await advanceRecoveryDelay(999);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(2);

    await advanceRecoveryDelay(1);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(3);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(3);
  });

  it("hard-fails exactly once after four throttled live attach recoveries", async () => {
    getChatSnapshotMock
      .mockResolvedValueOnce(createChatSnapshot())
      .mockResolvedValue(createChatSnapshot({
        sessionId: "session-1",
        activeRun: createChatActiveRun(),
      }));
    consumeChatLiveStreamMock.mockImplementation(async () => {
      throw createRecoverableAttachThrottleError(null);
    });

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    for (const delayMs of [500, 1_000, 2_000, 4_000]) {
      await advanceRecoveryDelay(delayMs);
    }

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(getChatSnapshotMock).toHaveBeenCalledTimes(5);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(5);
    expect(captureWebExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "chat_live_stream_failed",
      scope: expect.objectContaining({
        requestId: "request-throttle-1",
        statusCode: 429,
        code: null,
      }),
    }));
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("cancels a pending throttle backoff when the chat surface unmounts", async () => {
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot());
    consumeChatLiveStreamMock.mockRejectedValueOnce(createRecoverableAttachThrottleError(null));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();
    await unmountChatPanel();
    await advanceRecoveryDelay(4_000);

    expect(getChatSnapshotMock).toHaveBeenCalledTimes(1);
    expect(consumeChatLiveStreamMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).not.toHaveBeenCalled();
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
        null,
      ),
    ],
    [
      "coded HTTP 429",
      () => new ChatLiveHttpErrorMock(
        "AI live stream failed with status 429: Account rate limit reached",
        429,
        "request-http-2",
        "CHAT_RATE_LIMITED",
        1_000,
      ),
    ],
    [
      "other HTTP 4xx",
      () => new ChatLiveHttpErrorMock(
        "AI live stream failed with status 403: Forbidden",
        403,
        "request-http-3",
        null,
        null,
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
