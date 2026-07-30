import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseDeadlineExceededError } from "../../../database";
import {
  runPersistedChatSessionWithDeps,
} from "../../runtime";
import {
  CHAT_WORKER_INACTIVE_RECONCILIATION_MAXIMUM_MS,
  CHAT_WORKER_TERMINAL_PERSISTENCE_RESERVE_MS,
} from "../../runtime/control";
import type {
  OpenAILoopCompletion,
  OpenAILoopEventSink,
  StartOpenAILoopParams,
} from "../../openai/loop";
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
} from "./testSupport";

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

test("run-inactive reconciliation gets a fresh bounded deadline after the image deadline expires", async () => {
  for (const inactiveOutcome of ["user_cancelled", "ownership_lost"] as const) {
    const remainingRuntimeValues = [
      CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS + 60_000,
      CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
      CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS - 1,
    ];
    let remainingRuntimeIndex = 0;
    let imageOperationDeadlineMs = 0;
    let reconciliationDeadlineMs = 0;
    let reconciliationStartedAtMs = 0;
    let cancelledPersistCount = 0;
    let terminalPersistCount = 0;

    const result = await runPersistedChatSessionWithDeps(
      {
        ...createParams(),
        getRemainingTimeInMillis: (): number => {
          const value = remainingRuntimeValues[remainingRuntimeIndex]
            ?? remainingRuntimeValues.at(-1)
            ?? 0;
          remainingRuntimeIndex += 1;
          return value;
        },
      },
      createDependencies({
        startOpenAILoop: async (
          params: StartOpenAILoopParams,
        ): Promise<OpenAILoopCompletion> => {
          imageOperationDeadlineMs = params.generatedImageOperationDeadlineMs;
          return { openaiItems: [], terminationReason: "run_inactive" };
        },
        reconcileInactiveChatRun: async (_userId, _workspaceId, params) => {
          reconciliationStartedAtMs = Date.now();
          reconciliationDeadlineMs = params.databaseDeadlineAtMs;
          return inactiveOutcome;
        },
        persistAssistantCancelled: async () => {
          cancelledPersistCount += 1;
        },
        persistAssistantTerminalError: async () => {
          terminalPersistCount += 1;
        },
      }),
    );

    assert.ok(imageOperationDeadlineMs <= reconciliationStartedAtMs);
    assert.ok(reconciliationDeadlineMs > reconciliationStartedAtMs);
    assert.ok(
      reconciliationDeadlineMs - reconciliationStartedAtMs
      <= CHAT_WORKER_INACTIVE_RECONCILIATION_MAXIMUM_MS,
    );
    assert.deepEqual(
      result,
      inactiveOutcome === "user_cancelled"
        ? {
          outcome: "cancelled",
          abortReason: "user_cancelled",
          runStatus: "cancelled",
          sessionState: "idle",
        }
        : {
          outcome: "ownership_lost",
          abortReason: "ownership_lost",
          runStatus: null,
          sessionState: null,
        },
    );
    assert.equal(
      cancelledPersistCount,
      inactiveOutcome === "user_cancelled" ? 1 : 0,
    );
    assert.equal(terminalPersistCount, 0);
  }
});

test("run-inactive reconciliation keeps insufficient remaining runtime explicit", async () => {
  const remainingRuntimeValues = [
    CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS + 60_000,
    CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
    CHAT_WORKER_TERMINAL_PERSISTENCE_RESERVE_MS,
  ];
  let remainingRuntimeIndex = 0;
  let reconciliationDeadlineMs = 0;
  let reconciliationCallCount = 0;
  let terminalPersistCount = 0;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      {
        ...createParams(),
        getRemainingTimeInMillis: (): number => {
          const value = remainingRuntimeValues[remainingRuntimeIndex]
            ?? remainingRuntimeValues.at(-1)
            ?? 0;
          remainingRuntimeIndex += 1;
          return value;
        },
      },
      createDependencies({
        startOpenAILoop: async (): Promise<OpenAILoopCompletion> => ({
          openaiItems: [],
          terminationReason: "run_inactive",
        }),
        reconcileInactiveChatRun: async (_userId, _workspaceId, params) => {
          reconciliationCallCount += 1;
          reconciliationDeadlineMs = params.databaseDeadlineAtMs;
          throw new DatabaseDeadlineExceededError(
            "pool_checkout",
            params.databaseDeadlineAtMs,
            null,
          );
        },
        persistAssistantTerminalError: async () => {
          terminalPersistCount += 1;
        },
      }),
    );

    assert.deepEqual(result, {
      outcome: "failed",
      abortReason: null,
      runStatus: "failed",
      sessionState: "idle",
    });
  });

  assert.equal(reconciliationCallCount, 1);
  assert.ok(reconciliationDeadlineMs <= Date.now());
  assert.equal(terminalPersistCount, 1);
  assert.equal(
    findLog(logs, "chat_worker_terminal_state_persisted")?.errorClass,
    "DatabaseDeadlineExceededError",
  );
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
