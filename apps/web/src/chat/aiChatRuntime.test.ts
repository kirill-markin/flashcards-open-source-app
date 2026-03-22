import { describe, expect, it, vi } from "vitest";
import { runAIChatRuntime, type AIChatRuntimeCallbacks, type AIChatRuntimeDependencies } from "./aiChatRuntime";
import { createSSELine, createStreamResponse, streamDeltaPayload } from "./ChatPanelTestSupport";

function makeCallbacks(): AIChatRuntimeCallbacks {
  return {
    onAssistantStarted: vi.fn(),
    onAssistantText: vi.fn(),
    onToolCallStarted: vi.fn(),
    onToolCallCompleted: vi.fn(),
    onAssistantCompleted: vi.fn(),
    onAssistantError: vi.fn(),
    onCodeInterpreterContainerIdChanged: vi.fn(),
    onDiagnostics: vi.fn(),
  };
}

function makeDependencies(response: Response): AIChatRuntimeDependencies {
  return {
    createRequestBody: (
      messages,
      model,
      timezone,
      chatSessionId,
      codeInterpreterContainerId,
    ) => ({
      messages,
      model,
      timezone,
      devicePlatform: "web",
      chatSessionId,
      codeInterpreterContainerId,
      userContext: { totalCards: 1 },
    }),
    streamChat: vi.fn(async () => response),
    reportDiagnostics: vi.fn(async () => undefined),
    generateRequestId: () => "client-request-1",
    now: () => 1,
    appVersion: "1.0.1",
    devicePlatform: "web",
  };
}

describe("runAIChatRuntime", () => {
  it("streams text and backend tool-call progress without continuation", async () => {
    const callbacks = makeCallbacks();
    await runAIChatRuntime(
      makeDependencies(createStreamResponse([
        streamDeltaPayload("Checking"),
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SELECT 1\"}" }),
        createSSELine({ type: "tool_call", toolCallId: "tool-1", name: "sql", status: "completed", input: "{\"sql\":\"SELECT 1\"}", output: "{\"ok\":true}" }),
        createSSELine({ type: "done" }),
      ], 200)),
      {
        initialMessages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        selectedModel: "gpt-5.4",
        timezone: "Europe/Madrid",
        chatSessionId: "chat-1",
        initialCodeInterpreterContainerId: null,
        tapStartedAt: 0,
        signal: new AbortController().signal,
        callbacks,
      },
    );

    expect(callbacks.onAssistantText).toHaveBeenCalledWith("Checking");
    expect(callbacks.onToolCallStarted).toHaveBeenCalledWith("sql", "tool-1", "{\"sql\":\"SELECT 1\"}");
    expect(callbacks.onToolCallCompleted).toHaveBeenCalledWith("tool-1", "{\"sql\":\"SELECT 1\"}", "{\"ok\":true}");
    expect(callbacks.onAssistantCompleted).toHaveBeenCalled();
    expect(callbacks.onAssistantError).not.toHaveBeenCalled();
  });

  it("surfaces backend error events directly", async () => {
    const callbacks = makeCallbacks();
    await runAIChatRuntime(
      makeDependencies(createStreamResponse([
        createSSELine({ type: "error", message: "boom", code: "AI_CHAT_STREAM_FAILED", stage: "stream_ai_chat_turn", requestId: "request-1" }),
      ], 200)),
      {
        initialMessages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        selectedModel: "gpt-5.4",
        timezone: "Europe/Madrid",
        chatSessionId: "chat-1",
        initialCodeInterpreterContainerId: null,
        tapStartedAt: 0,
        signal: new AbortController().signal,
        callbacks,
      },
    );

    expect(callbacks.onAssistantError).toHaveBeenCalledWith("boom");
    expect(callbacks.onAssistantCompleted).not.toHaveBeenCalled();
  });
});
