import assert from "node:assert/strict";
import test from "node:test";
import type { StoredOpenAIReplayItem } from "./openai/replayItems";
import type { ChatStreamEvent } from "./types";
import {
  clearActiveChatRunForTests,
  createActiveChatRunForTests,
  runPersistedChatSessionWithDeps,
  stopActiveChatRun,
  type ChatRuntimeDependencies,
  type StartPersistedChatRunParams,
} from "./runtime";

function createStartedResponse(
  events: ReadonlyArray<ChatStreamEvent>,
  terminalError: unknown | null,
  openaiItems: ReadonlyArray<StoredOpenAIReplayItem>,
): Awaited<ReturnType<ChatRuntimeDependencies["startOpenAILoop"]>> {
  return {
    completion: terminalError === null
      ? Promise.resolve({ openaiItems })
      : Promise.reject(terminalError),
    events: (async function* (): AsyncGenerator<ChatStreamEvent> {
      for (const event of events) {
        yield event;
      }
    })(),
  };
}

function createParams(): StartPersistedChatRunParams {
  return {
    requestId: "req-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    timezone: "Europe/Madrid",
    assistantItemId: "assistant-1",
    localMessages: [{
      role: "user",
      content: [{ type: "text", text: "Import this" }],
    }],
    turnInput: [{ type: "text", text: "Import this" }],
    diagnostics: {
      requestId: "req-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      model: "gpt-5.4",
      messageCount: 1,
      hasAttachments: false,
      attachmentFileNames: [],
    },
  };
}

function createDependencies(
  startOpenAILoopImpl: ChatRuntimeDependencies["startOpenAILoop"],
  completeChatRunCalls: Array<Readonly<Record<string, unknown>>>,
  persistAssistantCancelledCalls: Array<Readonly<Record<string, unknown>>>,
  persistAssistantTerminalErrorCalls: Array<Readonly<Record<string, unknown>>>,
  updateAssistantMessageItemCalls: Array<Readonly<Record<string, unknown>>>,
  updateAssistantMessageItemAndInvalidateMainContentCalls: Array<Readonly<Record<string, unknown>>>,
): ChatRuntimeDependencies {
  return {
    startOpenAILoop: startOpenAILoopImpl,
    completeChatRun: async (_userId, _workspaceId, params): Promise<void> => {
      completeChatRunCalls.push(params as unknown as Readonly<Record<string, unknown>>);
    },
    persistAssistantCancelled: async (_userId, _workspaceId, params): Promise<void> => {
      persistAssistantCancelledCalls.push(params as unknown as Readonly<Record<string, unknown>>);
    },
    persistAssistantTerminalError: async (_userId, _workspaceId, params): Promise<void> => {
      persistAssistantTerminalErrorCalls.push(params as unknown as Readonly<Record<string, unknown>>);
    },
    touchChatSessionHeartbeat: async (): Promise<void> => undefined,
    updateAssistantMessageItem: async (_userId, _workspaceId, params): Promise<never> => {
      updateAssistantMessageItemCalls.push(params as unknown as Readonly<Record<string, unknown>>);
      return undefined as never;
    },
    updateAssistantMessageItemAndInvalidateMainContent: async (_userId, _workspaceId, params): Promise<number> => {
      updateAssistantMessageItemAndInvalidateMainContentCalls.push(params as unknown as Readonly<Record<string, unknown>>);
      return 1;
    },
    beginTaskProtection: async (): Promise<void> => undefined,
    endTaskProtection: async (): Promise<void> => undefined,
  };
}

test("runPersistedChatSessionWithDeps completes a plain turn and stores replay items", async () => {
  const completeChatRunCalls: Array<Readonly<Record<string, unknown>>> = [];
  const persistAssistantCancelledCalls: Array<Readonly<Record<string, unknown>>> = [];
  const persistAssistantTerminalErrorCalls: Array<Readonly<Record<string, unknown>>> = [];
  const updateAssistantMessageItemCalls: Array<Readonly<Record<string, unknown>>> = [];
  const updateAssistantMessageItemAndInvalidateMainContentCalls: Array<Readonly<Record<string, unknown>>> = [];

  const dependencies = createDependencies(
    async () =>
      createStartedResponse([
        {
          type: "delta",
          text: "Finished import plan.",
          itemId: "msg-1",
          outputIndex: 0,
          contentIndex: 0,
          sequenceNumber: 1,
        },
        { type: "done" },
      ], null, [{
        type: "message",
        role: "assistant",
        status: "completed",
        phase: "final_answer",
        content: [{
          type: "output_text",
          text: "Finished import plan.",
          annotations: [],
        }],
      }]),
    completeChatRunCalls,
    persistAssistantCancelledCalls,
    persistAssistantTerminalErrorCalls,
    updateAssistantMessageItemCalls,
    updateAssistantMessageItemAndInvalidateMainContentCalls,
  );

  await runPersistedChatSessionWithDeps(createParams(), dependencies);

  assert.equal(persistAssistantCancelledCalls.length, 0);
  assert.equal(persistAssistantTerminalErrorCalls.length, 0);
  assert.equal(updateAssistantMessageItemAndInvalidateMainContentCalls.length, 0);
  assert.equal(completeChatRunCalls.length, 1);
  assert.equal(updateAssistantMessageItemCalls.length > 0, true);
});

test("runPersistedChatSessionWithDeps persists invalidation only for completed mutating tool calls", async () => {
  const completeChatRunCalls: Array<Readonly<Record<string, unknown>>> = [];
  const persistAssistantCancelledCalls: Array<Readonly<Record<string, unknown>>> = [];
  const persistAssistantTerminalErrorCalls: Array<Readonly<Record<string, unknown>>> = [];
  const updateAssistantMessageItemCalls: Array<Readonly<Record<string, unknown>>> = [];
  const updateAssistantMessageItemAndInvalidateMainContentCalls: Array<Readonly<Record<string, unknown>>> = [];

  const dependencies = createDependencies(
    async () =>
      createStartedResponse([
        {
          type: "tool_call",
          id: "tool-1",
          itemId: "tool-item-1",
          name: "sql",
          status: "completed",
          outputIndex: 0,
          sequenceNumber: 1,
          input: "{\"sql\":\"INSERT INTO cards VALUES ('x')\"}",
          output: "{\"ok\":true}",
          refreshRoute: true,
        },
        { type: "done" },
      ], null, []),
    completeChatRunCalls,
    persistAssistantCancelledCalls,
    persistAssistantTerminalErrorCalls,
    updateAssistantMessageItemCalls,
    updateAssistantMessageItemAndInvalidateMainContentCalls,
  );

  await runPersistedChatSessionWithDeps(createParams(), dependencies);

  assert.equal(updateAssistantMessageItemAndInvalidateMainContentCalls.length, 1);
  assert.equal(completeChatRunCalls.length, 1);
});

test("stopActiveChatRun aborts the active session and closes it for tests", () => {
  createActiveChatRunForTests("session-stop");
  assert.equal(stopActiveChatRun("session-stop"), true);
  clearActiveChatRunForTests("session-stop");
});
