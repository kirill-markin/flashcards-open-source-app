import assert from "node:assert/strict";
import test from "node:test";
import type { StoredOpenAIReplayItem } from "./openai/replayItems";
import type { ChatStreamEvent } from "./types";
import {
  ChatRunOwnershipLostError,
  runPersistedChatSessionWithDeps,
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
    runId: "run-1",
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
  options?: Readonly<{
    heartbeatStates?: ReadonlyArray<Readonly<{ cancellationRequested: boolean; ownershipLost: boolean }>>;
  }>,
): Readonly<{
  dependencies: ChatRuntimeDependencies;
  completeChatRunCalls: Array<Readonly<Record<string, unknown>>>;
  persistAssistantCancelledCalls: Array<Readonly<Record<string, unknown>>>;
  persistAssistantTerminalErrorCalls: Array<Readonly<Record<string, unknown>>>;
  updateAssistantMessageItemCalls: Array<Readonly<Record<string, unknown>>>;
  updateAssistantMessageItemAndInvalidateMainContentCalls: Array<Readonly<Record<string, unknown>>>;
}> {
  const completeChatRunCalls: Array<Readonly<Record<string, unknown>>> = [];
  const persistAssistantCancelledCalls: Array<Readonly<Record<string, unknown>>> = [];
  const persistAssistantTerminalErrorCalls: Array<Readonly<Record<string, unknown>>> = [];
  const updateAssistantMessageItemCalls: Array<Readonly<Record<string, unknown>>> = [];
  const updateAssistantMessageItemAndInvalidateMainContentCalls: Array<Readonly<Record<string, unknown>>> = [];
  const heartbeatStates = [...(options?.heartbeatStates ?? [{
    cancellationRequested: false,
    ownershipLost: false,
  }])];

  return {
    completeChatRunCalls,
    persistAssistantCancelledCalls,
    persistAssistantTerminalErrorCalls,
    updateAssistantMessageItemCalls,
    updateAssistantMessageItemAndInvalidateMainContentCalls,
    dependencies: {
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
      touchChatRunHeartbeat: async (): Promise<{ cancellationRequested: boolean; ownershipLost: boolean }> => {
        return heartbeatStates.shift() ?? {
          cancellationRequested: false,
          ownershipLost: false,
        };
      },
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
    },
  };
}

test("runPersistedChatSessionWithDeps completes a plain turn and stores replay items", async () => {
  const { dependencies, completeChatRunCalls, persistAssistantCancelledCalls, persistAssistantTerminalErrorCalls, updateAssistantMessageItemCalls, updateAssistantMessageItemAndInvalidateMainContentCalls } = createDependencies(
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
  );

  await runPersistedChatSessionWithDeps(createParams(), dependencies);

  assert.equal(persistAssistantCancelledCalls.length, 0);
  assert.equal(persistAssistantTerminalErrorCalls.length, 0);
  assert.equal(updateAssistantMessageItemAndInvalidateMainContentCalls.length, 0);
  assert.equal(completeChatRunCalls.length, 1);
  assert.equal(updateAssistantMessageItemCalls.length > 0, true);
});

test("runPersistedChatSessionWithDeps persists invalidation only for completed mutating tool calls", async () => {
  const { dependencies, completeChatRunCalls, updateAssistantMessageItemAndInvalidateMainContentCalls } = createDependencies(
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
  );

  await runPersistedChatSessionWithDeps(createParams(), dependencies);

  assert.equal(updateAssistantMessageItemAndInvalidateMainContentCalls.length, 1);
  assert.equal(completeChatRunCalls.length, 1);
});

test("runPersistedChatSessionWithDeps persists cancellation when heartbeat reports a user stop", async () => {
  const { dependencies, persistAssistantCancelledCalls, completeChatRunCalls } = createDependencies(
    async () =>
      createStartedResponse([
        {
          type: "delta",
          text: "Partial answer",
          itemId: "msg-1",
          outputIndex: 0,
          contentIndex: 0,
          sequenceNumber: 1,
        },
      ], null, []),
    {
      heartbeatStates: [
        { cancellationRequested: true, ownershipLost: false },
      ],
    },
  );

  await runPersistedChatSessionWithDeps(createParams(), dependencies);

  assert.equal(persistAssistantCancelledCalls.length, 1);
  assert.equal(completeChatRunCalls.length, 0);
});

test("runPersistedChatSessionWithDeps exits cleanly when worker ownership is lost", async () => {
  const { dependencies, persistAssistantCancelledCalls, persistAssistantTerminalErrorCalls, completeChatRunCalls } = createDependencies(
    async () =>
      createStartedResponse([], null, []),
    {
      heartbeatStates: [
        { cancellationRequested: false, ownershipLost: true },
      ],
    },
  );

  await assert.doesNotReject(() => runPersistedChatSessionWithDeps(createParams(), dependencies));
  assert.equal(persistAssistantCancelledCalls.length, 0);
  assert.equal(persistAssistantTerminalErrorCalls.length, 0);
  assert.equal(completeChatRunCalls.length, 0);
});

test("ChatRunOwnershipLostError keeps a stable message", () => {
  const error = new ChatRunOwnershipLostError("run-1");
  assert.equal(error.message, "Chat run ownership lost: run-1");
});
