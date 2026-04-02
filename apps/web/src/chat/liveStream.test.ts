// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatLiveContractError,
  consumeChatLiveStream,
  parseChatLiveEvent,
} from "./liveStream";

function createEventMetadata(
  overrides?: Partial<{
    sessionId: string;
    conversationScopeId: string;
    runId: string;
    cursor: string | null;
    sequenceNumber: number;
    streamEpoch: string;
  }>,
): Record<string, string | number | null> {
  return {
    sessionId: "session-1",
    conversationScopeId: "session-1",
    runId: "run-1",
    cursor: "10",
    sequenceNumber: 1,
    streamEpoch: "epoch-1",
    ...overrides,
  };
}

function createLiveStreamResponse(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("parseChatLiveEvent", () => {
  it("accepts valid assistant tool call payloads with extra fields", () => {
    expect(parseChatLiveEvent("assistant_tool_call", JSON.stringify({
      ...createEventMetadata(),
      toolCallId: "tool-1",
      name: "sql",
      status: "completed",
      input: "{\"sql\":\"SELECT 1\"}",
      output: "{\"rows\":[1]}",
      providerStatus: "done",
      cursor: "10",
      itemId: "item-1",
      outputIndex: 0,
      ignoredFutureField: "ok",
    }))).toEqual({
      ...createEventMetadata(),
      type: "assistant_tool_call",
      toolCallId: "tool-1",
      name: "sql",
      status: "completed",
      input: "{\"sql\":\"SELECT 1\"}",
      output: "{\"rows\":[1]}",
      providerStatus: "done",
      cursor: "10",
      itemId: "item-1",
      outputIndex: 0,
    });
  });

  it("rejects missing required fields", () => {
    expect(() => parseChatLiveEvent("assistant_delta", JSON.stringify({
      ...createEventMetadata(),
      cursor: "10",
      itemId: "item-1",
    }))).toThrow(ChatLiveContractError);
  });

  it("rejects wrong runtime types", () => {
    expect(() => parseChatLiveEvent("assistant_message_done", JSON.stringify({
      ...createEventMetadata(),
      cursor: "10",
      itemId: "item-1",
      content: "not-an-array",
      isError: "false",
      isStopped: false,
    }))).toThrow("Invalid API response for assistant_message_done: content must be array");
  });

  it("rejects unknown enum values", () => {
    expect(() => parseChatLiveEvent("assistant_tool_call", JSON.stringify({
      ...createEventMetadata(),
      toolCallId: "tool-1",
      name: "sql",
      status: "pending",
      cursor: "10",
      itemId: "item-1",
      outputIndex: 0,
    }))).toThrow(ChatLiveContractError);
  });
});

describe("consumeChatLiveStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails the stream when an SSE payload is malformed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createLiveStreamResponse(
      "event: assistant_delta\n"
        + "data: {\"cursor\":\"1\",\"itemId\":\"item-1\"}\n\n",
    ));

    await expect(consumeChatLiveStream({
      liveStream: {
        url: "https://chat-live.example.com",
        authorization: "Live token",
        expiresAt: Date.now() + 60_000,
      },
      sessionId: "session-1",
      runId: "run-1",
      afterCursor: null,
      resumeAttemptId: null,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })).rejects.toBeInstanceOf(ChatLiveContractError);
  });

  it("sends resume diagnostics headers for resumed live attaches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createLiveStreamResponse(
      "event: assistant_delta\n"
        + `data: ${JSON.stringify({
          ...createEventMetadata({ cursor: "1" }),
          type: "assistant_delta",
          text: "hello",
          itemId: "item-1",
        })}\n\n`,
    ));

    await consumeChatLiveStream({
      liveStream: {
        url: "https://chat-live.example.com",
        authorization: "Live token",
        expiresAt: Date.now() + 60_000,
      },
      sessionId: "session-1",
      runId: "run-1",
      afterCursor: "5",
      resumeAttemptId: 3,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Chat-Resume-Attempt-Id")).toBe("3");
    expect(headers.get("X-Client-Platform")).toBe("web");
    expect(headers.get("X-Client-Version")).toBeTruthy();
  });
});
