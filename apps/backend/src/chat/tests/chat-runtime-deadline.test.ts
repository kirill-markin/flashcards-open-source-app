import assert from "node:assert/strict";
import test from "node:test";
import {
  runPersistedChatSessionWithDeps,
} from "../runtime";
import type {
  OpenAILoopCompletion,
  OpenAILoopEventSink,
  StartOpenAILoopParams,
} from "../openai/loop";
import {
  CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
  DEADLINE_REACHED_MESSAGE,
  type PersistAssistantTerminalErrorParams,
  createCompletedLoopCompletion,
  createDeferredPromise,
  createDependencies,
  createParams,
  findLog,
  withCapturedLogs,
  withControlledHeartbeat,
} from "./chat-runtime-test-support";

test("runPersistedChatSessionWithDeps interrupts immediately when the lambda is already inside the pre-timeout buffer", async () => {
  let startOpenAILoopCalled = false;
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      {
        ...createParams(),
        getRemainingTimeInMillis: (): number => CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
      },
      createDependencies({
        startOpenAILoop: async () => {
          startOpenAILoopCalled = true;
          return createCompletedLoopCompletion();
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistParams = params;
        },
      }),
    );

    assert.deepEqual(result, {
      outcome: "interrupted",
      abortReason: "deadline_reached",
      runStatus: "interrupted",
      sessionState: "interrupted",
    });
  });

  assert.equal(startOpenAILoopCalled, false);
  assert.deepEqual(terminalPersistParams, {
    runId: "run-1",
    sessionId: "session-1",
    assistantItemId: "assistant-item-1",
    assistantContent: [],
    assistantOpenAIItems: undefined,
    errorMessage: DEADLINE_REACHED_MESSAGE,
    sessionState: "interrupted",
  });
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "deadline_reached");
  assert.equal(findLog(logs, "chat_worker_provider_call_started"), undefined);
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "interrupted");
});

test("runPersistedChatSessionWithDeps re-checks the deadline after task protection and skips provider work", async () => {
  let startOpenAILoopCalled = false;
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;
  let remainingTimeMs = CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS + 1;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      {
        ...createParams(),
        getRemainingTimeInMillis: (): number => remainingTimeMs,
      },
      createDependencies({
        beginTaskProtection: async (): Promise<void> => {
          remainingTimeMs = CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS;
        },
        startOpenAILoop: async () => {
          startOpenAILoopCalled = true;
          return createCompletedLoopCompletion();
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistParams = params;
        },
      }),
    );

    assert.deepEqual(result, {
      outcome: "interrupted",
      abortReason: "deadline_reached",
      runStatus: "interrupted",
      sessionState: "interrupted",
    });
  });

  assert.equal(startOpenAILoopCalled, false);
  assert.deepEqual(terminalPersistParams, {
    runId: "run-1",
    sessionId: "session-1",
    assistantItemId: "assistant-item-1",
    assistantContent: [],
    assistantOpenAIItems: undefined,
    errorMessage: DEADLINE_REACHED_MESSAGE,
    sessionState: "interrupted",
  });
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "deadline_reached");
  assert.equal(findLog(logs, "chat_worker_provider_call_started"), undefined);
});

test("runPersistedChatSessionWithDeps interrupts gracefully on the soft deadline and finalizes partial assistant state", async () => {
  let terminalPersistCount = 0;
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;
  const loopReady = createDeferredPromise<void>();
  const allowToolCompletion = createDeferredPromise<void>();
  const interruptedOpenAIItems: OpenAILoopCompletion["openaiItems"] = [
    {
      type: "function_call",
      call_id: "call-1",
      name: "search_cards",
      arguments: "{\"query\":\"bio\"}",
      status: "completed",
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: "{\"ok\":true}",
    },
  ];

  const logs = await withCapturedLogs(async () => {
    await withControlledHeartbeat(async ({ triggerSoftDeadline }) => {
      const runtimePromise = runPersistedChatSessionWithDeps(
        {
          ...createParams(),
          getRemainingTimeInMillis: (): number => CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS + 1,
        },
        createDependencies({
          startOpenAILoop: async (
            params: StartOpenAILoopParams,
            onEvent: OpenAILoopEventSink,
          ): Promise<OpenAILoopCompletion> => {
            await onEvent({
              type: "delta",
              text: "partial",
              itemId: "assistant-item-1",
              outputIndex: 0,
              contentIndex: 0,
              sequenceNumber: 1,
            });
            await onEvent({
              type: "tool_call",
              id: "tool-1",
              itemId: "assistant-item-1",
              name: "search_cards",
              status: "started",
              outputIndex: 0,
              sequenceNumber: 2,
              input: "{\"query\":\"bio\"}",
            });

            params.onExecutionPhaseChanged?.("tool");
            loopReady.resolve(undefined);
            await allowToolCompletion.promise;
            await onEvent({
              type: "tool_call",
              id: "tool-1",
              itemId: "assistant-item-1",
              name: "search_cards",
              status: "completed",
              outputIndex: 0,
              sequenceNumber: 3,
              input: "{\"query\":\"bio\"}",
              output: "{\"ok\":true}",
              providerStatus: "completed",
            });
            params.onExecutionPhaseChanged?.("idle");

            return {
              openaiItems: interruptedOpenAIItems,
              terminationReason: "stopped_before_next_step",
            };
          },
          persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
            terminalPersistCount += 1;
            terminalPersistParams = params;
          },
        }),
      );

      await loopReady.promise;
      await triggerSoftDeadline();
      allowToolCompletion.resolve(undefined);

      const result = await runtimePromise;
      assert.deepEqual(result, {
        outcome: "interrupted",
        abortReason: "deadline_reached",
        runStatus: "interrupted",
        sessionState: "interrupted",
      });
    });
  });

  assert.equal(terminalPersistCount, 1);
  assert.deepEqual(terminalPersistParams, {
    runId: "run-1",
    sessionId: "session-1",
    assistantItemId: "assistant-item-1",
    assistantContent: [
      {
        type: "text",
        text: "partial",
        streamPosition: {
          itemId: "assistant-item-1",
          responseIndex: undefined,
          outputIndex: 0,
          contentIndex: 0,
          sequenceNumber: 1,
        },
      },
      {
        type: "tool_call",
        id: "tool-1",
        name: "search_cards",
        status: "completed",
        providerStatus: "completed",
        input: "{\"query\":\"bio\"}",
        output: "{\"ok\":true}",
        streamPosition: {
          itemId: "assistant-item-1",
          responseIndex: undefined,
          outputIndex: 0,
          contentIndex: null,
          sequenceNumber: 2,
        },
      },
    ],
    assistantOpenAIItems: interruptedOpenAIItems,
    errorMessage: DEADLINE_REACHED_MESSAGE,
    sessionState: "interrupted",
  });
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "deadline_reached");
  assert.equal(findLog(logs, "chat_worker_provider_call_aborted"), undefined);
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "interrupted");
});
