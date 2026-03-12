import { describe, expect, it, vi } from "vitest";
import { runLocalChatRuntime, type LocalChatRuntimeCallbacks, type LocalChatRuntimeDependencies } from "./localChatRuntime";
import type { LocalChatDiagnosticsPayload, LocalChatMessage, LocalChatRequestBody } from "../types";

type RuntimeHarness = Readonly<{
  dependencies: LocalChatRuntimeDependencies;
  callbacks: LocalChatRuntimeCallbacks;
  createRequestBodyMock: ReturnType<typeof vi.fn>;
  streamChatMock: ReturnType<typeof vi.fn>;
  executeToolMock: ReturnType<typeof vi.fn>;
  reportDiagnosticsMock: ReturnType<typeof vi.fn>;
  onAssistantStartedMock: ReturnType<typeof vi.fn>;
  onAssistantTextMock: ReturnType<typeof vi.fn>;
  onToolCallStartedMock: ReturnType<typeof vi.fn>;
  onToolCallCompletedMock: ReturnType<typeof vi.fn>;
  onAssistantCompletedMock: ReturnType<typeof vi.fn>;
  onAssistantErrorMock: ReturnType<typeof vi.fn>;
  onDiagnosticsMock: ReturnType<typeof vi.fn>;
}>;

function createSSELine(event: object): string {
  return `data: ${JSON.stringify(event)}\n`;
}

function createStreamResponse(payloads: ReadonlyArray<string>, status: number = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(payload));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "x-chat-request-id": "backend-request-1",
    },
  });
}

function createRuntimeHarness(): RuntimeHarness {
  const createRequestBodyMock = vi.fn((
    messages: ReadonlyArray<LocalChatMessage>,
    model: string,
    timezone: string,
  ): LocalChatRequestBody => ({
    messages,
    model,
    timezone,
    devicePlatform: "web",
  }));
  const streamChatMock = vi.fn();
  const executeToolMock = vi.fn().mockResolvedValue({
    output: "{\"ok\":true}",
    didMutateAppState: false,
  });
  const reportDiagnosticsMock = vi.fn().mockResolvedValue(undefined);
  const onAssistantStartedMock = vi.fn();
  const onAssistantTextMock = vi.fn();
  const onToolCallStartedMock = vi.fn();
  const onToolCallCompletedMock = vi.fn();
  const onAssistantCompletedMock = vi.fn();
  const onAssistantErrorMock = vi.fn();
  const onDiagnosticsMock = vi.fn();

  return {
    dependencies: {
      createRequestBody: createRequestBodyMock,
      streamChat: streamChatMock,
      executeTool: executeToolMock,
      reportDiagnostics: reportDiagnosticsMock,
      generateRequestId: () => "client-request-1",
      now: () => 1_000,
      appVersion: "test-version",
      devicePlatform: "web",
    },
    callbacks: {
      onAssistantStarted: onAssistantStartedMock,
      onAssistantText: onAssistantTextMock,
      onToolCallStarted: onToolCallStartedMock,
      onToolCallCompleted: onToolCallCompletedMock,
      onAssistantCompleted: onAssistantCompletedMock,
      onAssistantError: onAssistantErrorMock,
      onDiagnostics: onDiagnosticsMock,
    },
    createRequestBodyMock,
    streamChatMock,
    executeToolMock,
    reportDiagnosticsMock,
    onAssistantStartedMock,
    onAssistantTextMock,
    onToolCallStartedMock,
    onToolCallCompletedMock,
    onAssistantCompletedMock,
    onAssistantErrorMock,
    onDiagnosticsMock,
  };
}

async function runHarness(harness: RuntimeHarness): Promise<void> {
  await runLocalChatRuntime(
    harness.dependencies,
    {
      initialMessages: [{
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }],
      selectedModel: "test-model",
      timezone: "Europe/Madrid",
      signal: new AbortController().signal,
      callbacks: harness.callbacks,
    },
  );
}

function readDiagnosticsPayload(mock: ReturnType<typeof vi.fn>): LocalChatDiagnosticsPayload {
  const firstCall = mock.mock.calls[0];
  if (firstCall === undefined) {
    throw new Error("Expected diagnostics callback to be called");
  }

  return firstCall[0] as LocalChatDiagnosticsPayload;
}

describe("runLocalChatRuntime", () => {
  it("streams assistant deltas without normalizing whitespace", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([
      createSSELine({ type: "delta", text: "\n\n   First" }),
      createSSELine({ type: "delta", text: "\nSecond   \n" }),
      createSSELine({ type: "done" }),
    ]));

    await runHarness(harness);

    expect(harness.onAssistantStartedMock).toHaveBeenCalledTimes(1);
    expect(harness.onAssistantTextMock.mock.calls).toEqual([
      ["\n\n   First"],
      ["\nSecond   \n"],
    ]);
    expect(harness.onAssistantCompletedMock).toHaveBeenCalledTimes(1);
    expect(harness.onAssistantErrorMock).not.toHaveBeenCalled();
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "success",
      eventType: "done",
      selectedModel: "test-model",
    });
  });

  it("executes pending tool calls and appends tool results to the next turn request", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "list_cards", input: "{\"limit\":10}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "delta", text: "Done" }),
        createSSELine({ type: "done" }),
      ]));

    await runHarness(harness);

    expect(harness.onToolCallStartedMock).toHaveBeenCalledWith("list_cards", "tool-1");
    expect(harness.executeToolMock).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      name: "list_cards",
      input: "{\"limit\":10}",
    });
    expect(harness.onToolCallCompletedMock).toHaveBeenCalledWith("tool-1", "{\"limit\":10}", "{\"ok\":true}");
    expect(harness.createRequestBodyMock).toHaveBeenCalledTimes(2);
    expect(harness.createRequestBodyMock.mock.calls[1]?.[0]).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
      {
        role: "assistant",
        content: [{
          type: "tool_call",
          toolCallId: "tool-1",
          name: "list_cards",
          status: "started",
          input: "{\"limit\":10}",
          output: null,
        }],
      },
      {
        role: "tool",
        toolCallId: "tool-1",
        name: "list_cards",
        output: "{\"ok\":true}",
      },
    ]);
  });

  it("fails when the runtime requests tool results without pending tool calls", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([
      createSSELine({ type: "await_tool_results" }),
    ]));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith(
      "The local chat runtime requested tool results without any tool call.",
    );
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "await_tool_results",
      errorKind: "missing_tool_call_request",
    });
  });

  it("reports invalid SSE payloads as decoding failures", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([
      "data: {not-valid-json}\n",
    ]));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith("The local chat stream returned an invalid event.");
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "decoding_event_json",
      errorKind: "invalid_sse_event_json",
      rawSnippet: "data: {not-valid-json}",
      lineNumber: 1,
    });
  });

  it("sanitizes non-ok HTML error responses", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(
      new Response("<html>blocked</html>", {
        status: 502,
        headers: {
          "x-chat-request-id": "backend-request-1",
        },
      }),
    );

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith(
      "Error 502: The request was blocked by an upstream HTML response.",
    );
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "response_not_ok",
      errorKind: "response_not_ok",
    });
  });

  it("treats successful streams without content as empty responses", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([]));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith("The assistant returned an empty response.");
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "empty_response",
      errorKind: "empty_response",
    });
  });

  it("reports tool execution failures and stops the turn", async () => {
    const harness = createRuntimeHarness();
    harness.executeToolMock.mockRejectedValueOnce(new Error("Tool failed"));
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([
      createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "list_cards", input: "{\"limit\":10}" }),
      createSSELine({ type: "await_tool_results" }),
    ]));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith("Tool failed");
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "tool_execution",
      errorKind: "tool_execution_failed",
      toolName: "list_cards",
      toolCallId: "tool-1",
    });
  });
});
