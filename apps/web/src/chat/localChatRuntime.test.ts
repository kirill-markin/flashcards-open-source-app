import { describe, expect, it, vi } from "vitest";
import { runLocalChatRuntime, type LocalChatRuntimeCallbacks, type LocalChatRuntimeDependencies } from "./localChatRuntime";
import type {
  LocalChatDiagnosticsPayload,
  LocalChatFailureDiagnosticsPayload,
  LocalChatLatencyDiagnosticsPayload,
  LocalChatMessage,
  LocalChatRequestBody,
} from "../types";

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

function createFailingStreamResponse(
  payloads: ReadonlyArray<string>,
  error: Error,
): Response {
  const encoder = new TextEncoder();
  let nextIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (nextIndex < payloads.length) {
        controller.enqueue(encoder.encode(payloads[nextIndex]));
        nextIndex += 1;
        return;
      }

      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
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
    userContext: {
      totalCards: 3,
    },
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
      tapStartedAt: 900,
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

function readDiagnosticsPayloadAt(
  mock: ReturnType<typeof vi.fn>,
  index: number,
): LocalChatDiagnosticsPayload {
  const call = mock.mock.calls[index];
  if (call === undefined) {
    throw new Error(`Expected diagnostics callback at index ${index}`);
  }

  return call[0] as LocalChatDiagnosticsPayload;
}

function readFailureDiagnosticsPayloads(
  mock: ReturnType<typeof vi.fn>,
): ReadonlyArray<LocalChatFailureDiagnosticsPayload> {
  return mock.mock.calls
    .map((call) => call[0] as LocalChatDiagnosticsPayload)
    .filter((payload): payload is LocalChatFailureDiagnosticsPayload => payload.kind === "failure");
}

function readLatencyDiagnosticsPayloads(
  mock: ReturnType<typeof vi.fn>,
): ReadonlyArray<LocalChatLatencyDiagnosticsPayload> {
  return mock.mock.calls
    .map((call) => call[0] as LocalChatDiagnosticsPayload)
    .filter((payload): payload is LocalChatLatencyDiagnosticsPayload => payload.kind === "latency");
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
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        stage: "success",
        eventType: "done",
        selectedModel: "test-model",
      }),
    ]);
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "success",
        firstEventType: "delta",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: true,
        tapToRequestStartMs: 100,
      }),
    ]);
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
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "delta", text: "Done" }),
        createSSELine({ type: "done" }),
      ]));

    await runHarness(harness);

    expect(harness.onToolCallStartedMock).toHaveBeenCalledWith("sql", "tool-1", "{\"sql\":\"SHOW TABLES\"}");
    expect(harness.executeToolMock).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      name: "sql",
      input: "{\"sql\":\"SHOW TABLES\"}",
    });
    expect(harness.onToolCallCompletedMock).toHaveBeenCalledWith("tool-1", "{\"sql\":\"SHOW TABLES\"}", "{\"ok\":true}");
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
          name: "sql",
          status: "started",
          input: "{\"sql\":\"SHOW TABLES\"}",
          output: null,
        }],
      },
      {
        role: "tool",
        toolCallId: "tool-1",
        name: "sql",
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

  it("feeds a failed tool result back into the next model request", async () => {
    const harness = createRuntimeHarness();
    harness.executeToolMock
      .mockRejectedValueOnce(new Error("Unsupported SELECT statement"))
      .mockResolvedValueOnce({
        output: "{\"ok\":true}",
        didMutateAppState: false,
      });
    harness.streamChatMock
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SELECT tags FROM cards\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "delta", text: "Corrected." }),
        createSSELine({ type: "done" }),
      ]));

    await runHarness(harness);

    expect(harness.onToolCallCompletedMock).toHaveBeenCalledWith(
      "tool-1",
      "{\"sql\":\"SELECT tags FROM cards\"}",
      "{\"ok\":false,\"error\":{\"code\":\"LOCAL_TOOL_EXECUTION_FAILED\",\"message\":\"Unsupported SELECT statement\"}}",
    );
    expect(harness.onAssistantErrorMock).not.toHaveBeenCalled();
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
          name: "sql",
          status: "started",
          input: "{\"sql\":\"SELECT tags FROM cards\"}",
          output: null,
        }],
      },
      {
        role: "tool",
        toolCallId: "tool-1",
        name: "sql",
        output: "{\"ok\":false,\"error\":{\"code\":\"LOCAL_TOOL_EXECUTION_FAILED\",\"message\":\"Unsupported SELECT statement\"}}",
      },
    ]);
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)[0]).toMatchObject({
      stage: "tool_execution",
      errorKind: "tool_execution_failed",
      toolName: "sql",
      toolCallId: "tool-1",
    });
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)[1]).toMatchObject({
      stage: "success",
      eventType: "done",
    });
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "success",
        firstEventType: "tool_call_request",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: false,
      }),
    ]);
    expect(harness.onAssistantCompletedMock).toHaveBeenCalledTimes(1);
  });

  it("stops after three consecutive tool execution failures", async () => {
    const harness = createRuntimeHarness();
    harness.executeToolMock.mockRejectedValue(new Error("Unsupported SELECT statement"));
    harness.streamChatMock
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SELECT tags FROM cards\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-2", name: "sql", input: "{\"sql\":\"SELECT tags FROM cards LIMIT 20\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-3", name: "sql", input: "{\"sql\":\"SELECT tags FROM cards LIMIT 10 OFFSET 0\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]));

    await runHarness(harness);

    expect(harness.createRequestBodyMock).toHaveBeenCalledTimes(3);
    expect(harness.onToolCallCompletedMock).toHaveBeenNthCalledWith(
      3,
      "tool-3",
      "{\"sql\":\"SELECT tags FROM cards LIMIT 10 OFFSET 0\"}",
      "{\"ok\":false,\"error\":{\"code\":\"LOCAL_TOOL_EXECUTION_FAILED\",\"message\":\"Unsupported SELECT statement\"}}",
    );
    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith(
      "Tool execution failed 3 times in a row. Last error: Unsupported SELECT statement",
    );
    expect(harness.onAssistantCompletedMock).not.toHaveBeenCalled();
    expect(harness.onDiagnosticsMock).toHaveBeenCalledTimes(4);
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)[2]).toMatchObject({
      stage: "tool_execution",
      errorKind: "tool_execution_failed",
      toolCallId: "tool-3",
    });
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "success",
        firstEventType: "tool_call_request",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: false,
      }),
    ]);
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
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "stream_error_before_first_delta",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: false,
      }),
    ]);
  });

  it("treats stream error events as terminal", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([
      createSSELine({
        type: "error",
        message: "Assistant could not prepare a valid tool call. Try again.",
        code: "LOCAL_TOOL_CALL_INVALID",
        stage: "tool_call_validation",
        requestId: "backend-request-1",
      }),
    ]));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith(
      "Assistant could not prepare a valid tool call. Try again.",
    );
    expect(harness.createRequestBodyMock).toHaveBeenCalledTimes(1);
    expect(readDiagnosticsPayload(harness.onDiagnosticsMock)).toMatchObject({
      stage: "tool_call_validation",
      errorKind: "LOCAL_TOOL_CALL_INVALID",
      eventType: "error",
      lineNumber: 1,
    });
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "stream_error_before_first_delta",
        firstEventType: "error",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: false,
      }),
    ]);
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
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "response_not_ok",
        statusCode: 502,
        didReceiveFirstSseLine: false,
        didReceiveFirstDelta: false,
      }),
    ]);
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
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "empty_response",
        didReceiveFirstSseLine: false,
        didReceiveFirstDelta: false,
      }),
    ]);
  });

  it("reports tool execution failures without stopping the turn immediately", async () => {
    const harness = createRuntimeHarness();
    harness.executeToolMock.mockRejectedValueOnce(new Error("Tool failed"));
    harness.streamChatMock
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "delta", text: "Recovered." }),
        createSSELine({ type: "done" }),
      ]));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).not.toHaveBeenCalled();
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)[0]).toMatchObject({
      stage: "tool_execution",
      errorKind: "tool_execution_failed",
      toolName: "sql",
      toolCallId: "tool-1",
    });
    expect(harness.createRequestBodyMock).toHaveBeenCalledTimes(2);
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "success",
        firstEventType: "tool_call_request",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: false,
      }),
    ]);
  });

  it("reports missing response readers in latency diagnostics", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(new Response(null, {
      status: 200,
      headers: {
        "x-chat-request-id": "backend-request-1",
      },
    }));

    await runHarness(harness);

    expect(harness.onAssistantErrorMock).toHaveBeenCalledWith("The local chat response stream is missing.");
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        stage: "missing_reader",
        errorKind: "missing_reader",
      }),
    ]);
    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "missing_reader",
        didReceiveFirstSseLine: false,
        didReceiveFirstDelta: false,
      }),
    ]);
  });

  it("reports cancellation before headers in latency diagnostics", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    await expect(runHarness(harness)).rejects.toThrow("Aborted");

    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "cancelled_before_headers",
        didReceiveFirstSseLine: false,
        didReceiveFirstDelta: false,
      }),
    ]);
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)).toHaveLength(0);
  });

  it("reports cancellation after headers before the first SSE line", async () => {
    const harness = createRuntimeHarness();
    const abortError = new DOMException("Aborted", "AbortError");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller): void {
        controller.error(abortError);
      },
    });
    harness.streamChatMock.mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: {
        "x-chat-request-id": "backend-request-1",
      },
    }));

    await expect(runHarness(harness)).rejects.toThrow("Aborted");

    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "cancelled_before_first_sse_line",
        didReceiveFirstSseLine: false,
        didReceiveFirstDelta: false,
      }),
    ]);
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)).toHaveLength(0);
  });

  it("reports cancellation after the first SSE line but before the first delta", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createFailingStreamResponse([
      createSSELine({
        type: "repair_attempt",
        message: "Retrying tool call",
        attempt: 1,
        maxAttempts: 3,
        toolName: "sql",
      }),
    ], new DOMException("Aborted", "AbortError")));

    await expect(runHarness(harness)).rejects.toThrow("Aborted");

    expect(readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)).toEqual([
      expect.objectContaining({
        result: "cancelled_before_first_delta",
        firstEventType: "repair_attempt",
        didReceiveFirstSseLine: true,
        didReceiveFirstDelta: false,
      }),
    ]);
    expect(readFailureDiagnosticsPayloads(harness.onDiagnosticsMock)).toHaveLength(0);
  });

  it("keeps latency diagnostics privacy-safe", async () => {
    const harness = createRuntimeHarness();
    harness.streamChatMock.mockResolvedValueOnce(createStreamResponse([
      createSSELine({ type: "delta", text: "Top secret answer" }),
      createSSELine({ type: "done" }),
    ]));

    await runHarness(harness);

    const latencyPayload = readLatencyDiagnosticsPayloads(harness.onDiagnosticsMock)[0];
    expect(latencyPayload).toBeDefined();
    expect("rawSnippet" in latencyPayload).toBe(false);
    expect("decoderSummary" in latencyPayload).toBe(false);
    expect(JSON.stringify(latencyPayload)).not.toContain("hello");
    expect(JSON.stringify(latencyPayload)).not.toContain("Top secret answer");
  });
});
