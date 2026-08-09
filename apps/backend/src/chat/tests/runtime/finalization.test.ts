import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatRunRowNotFoundError,
} from "../../errors";
import {
  runPersistedChatSessionWithDeps,
} from "../../runtime";
import {
  InactiveChatRunClaimError,
} from "../../runs";
import type {
  OpenAILoopCompletion,
  OpenAILoopEventSink,
  StartOpenAILoopParams,
} from "../../openai/loop";
import {
  createDependencies,
  createParams,
  findLog,
  withCapturedLogs,
} from "./testSupport";

test("runPersistedChatSessionWithDeps exits without failing when the claimed run disappears before completion persistence", async () => {
  let cancelledPersistCount = 0;
  let terminalPersistCount = 0;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      createParams(),
      createDependencies({
        startOpenAILoop: async (
          _params: StartOpenAILoopParams,
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
          return {
            openaiItems: [],
            terminationReason: "completed",
          };
        },
        completeChatRun: async () => {
          throw new ChatRunRowNotFoundError("complete");
        },
        persistAssistantCancelled: async () => {
          cancelledPersistCount += 1;
        },
        persistAssistantTerminalError: async () => {
          terminalPersistCount += 1;
        },
      }),
    );

    assert.deepEqual(result, {
      outcome: "ownership_lost",
      abortReason: "ownership_lost",
      runStatus: null,
      sessionState: null,
    });
  });

  assert.equal(cancelledPersistCount, 0);
  assert.equal(terminalPersistCount, 0);
  assert.equal(findLog(logs, "chat_worker_provider_call_started")?.action, "chat_worker_provider_call_started");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted"), undefined);
});

test("runPersistedChatSessionWithDeps maps stale failed, cancelled, and interrupted persistence to ownership loss", async () => {
  const staleTerminalPersistence = async (): Promise<never> => {
    throw new ChatRunRowNotFoundError("terminal");
  };
  const results = await Promise.all([
    runPersistedChatSessionWithDeps(createParams(), createDependencies({
      startOpenAILoop: async () => { throw new Error("Provider failed"); },
      persistAssistantTerminalError: staleTerminalPersistence,
    })),
    runPersistedChatSessionWithDeps(createParams(), createDependencies({
      touchChatRunHeartbeat: async () => ({ cancellationRequested: true, ownershipLost: false }),
      persistAssistantCancelled: staleTerminalPersistence,
    })),
    runPersistedChatSessionWithDeps(
      { ...createParams(), getRemainingTimeInMillis: (): number => 0 },
      createDependencies({ persistAssistantTerminalError: staleTerminalPersistence }),
    ),
  ]);
  assert.deepEqual(results.map((result) => result.outcome), [
    "ownership_lost",
    "ownership_lost",
    "ownership_lost",
  ]);
});

test("run-inactive completion and thrown claim errors reconcile cancellation and ownership", async () => {
  let cancelledPersistCount = 0;
  const outcomes = await Promise.all(
    (["completion", "thrown_claim"] as const).flatMap((inactiveMode) =>
      (["user_cancelled", "ownership_lost"] as const).map((inactiveOutcome) =>
        runPersistedChatSessionWithDeps(createParams(), createDependencies({
          startOpenAILoop: async () => {
            if (inactiveMode === "thrown_claim") {
              throw new InactiveChatRunClaimError(createParams().runId);
            }
            return { openaiItems: [], terminationReason: "run_inactive" };
          },
          reconcileInactiveChatRun: async () => inactiveOutcome,
          persistAssistantCancelled: async () => { cancelledPersistCount += 1; },
        }))),
    ),
  );
  assert.deepEqual(
    outcomes.map((result) => result.outcome),
    ["cancelled", "ownership_lost", "cancelled", "ownership_lost"],
  );
  assert.equal(cancelledPersistCount, 2);
});

test("runPersistedChatSessionWithDeps preserves every terminal persistence infrastructure error", async () => {
  const assertInfrastructureErrorPropagates = async (
    operation: string,
    params: ReturnType<typeof createParams>,
    overrides: Parameters<typeof createDependencies>[0],
  ): Promise<void> => {
    const databaseError = new Error(`Database unavailable during ${operation}`);
    let terminalPersistCount = 0;
    const persistTerminal = async (): Promise<never> => {
      terminalPersistCount += 1;
      throw databaseError;
    };
    const execution = runPersistedChatSessionWithDeps(params, createDependencies({
      ...overrides,
      completeChatRun: persistTerminal,
      persistAssistantCancelled: persistTerminal,
      persistAssistantTerminalError: persistTerminal,
    }));

    await assert.rejects(execution, (error: unknown): boolean => error === databaseError);
    assert.equal(terminalPersistCount, 1);
  };

  await assertInfrastructureErrorPropagates("completion", createParams(), {});
  await assertInfrastructureErrorPropagates("failure", createParams(), {
    startOpenAILoop: async (
      _params: StartOpenAILoopParams,
      onEvent: OpenAILoopEventSink,
    ): Promise<OpenAILoopCompletion> => {
      await onEvent({ type: "error", message: "Provider failed" });
      return { openaiItems: [], terminationReason: "completed" };
    },
  });
  await assertInfrastructureErrorPropagates("cancellation", createParams(), {
    touchChatRunHeartbeat: async () => ({
      cancellationRequested: true,
      ownershipLost: false,
    }),
  });
  await assertInfrastructureErrorPropagates(
    "interruption",
    { ...createParams(), getRemainingTimeInMillis: (): number => 0 },
    {},
  );
});

test("runPersistedChatSessionWithDeps completes a successful run and persists completion once", async () => {
  let completedPersistCount = 0;
  let composerSuggestionUserId: string | null = null;
  let composerSuggestionUiLocale: string | null | undefined = undefined;
  const observedClaimTokens: Array<string> = [];
  let generatedImageDeadlineMs = 0;
  const startedAtMs = Date.now();

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      { ...createParams(), generatedImageEligible: true },
      createDependencies({
        startOpenAILoop: async (
          params: StartOpenAILoopParams,
          onEvent: OpenAILoopEventSink,
        ): Promise<OpenAILoopCompletion> => {
          observedClaimTokens.push(params.claimToken);
          assert.equal(params.generatedImageEligible, true);
          generatedImageDeadlineMs = params.generatedImageOperationDeadlineMs;
          await onEvent({
            type: "delta",
            text: "done",
            itemId: "assistant-item-1",
            outputIndex: 0,
            contentIndex: 0,
            sequenceNumber: 1,
          });
          return {
            openaiItems: [],
            terminationReason: "completed",
          };
        },
        generateFollowUpChatComposerSuggestions: async (
          userId,
          _userContent,
          _assistantContent,
          _assistantItemId,
          uiLocale,
        ) => {
          composerSuggestionUserId = userId;
          composerSuggestionUiLocale = uiLocale;
          return [];
        },
        completeChatRun: async (_userId, _workspaceId, _params, claimToken) => {
          completedPersistCount += 1;
          observedClaimTokens.push(claimToken);
        },
        touchChatRunHeartbeat: async (
          _userId,
          _workspaceId,
          _runId,
          claimToken,
        ) => {
          observedClaimTokens.push(claimToken);
          return {
            cancellationRequested: false,
            ownershipLost: false,
          };
        },
      }),
    );

    assert.deepEqual(result, {
      outcome: "completed",
      abortReason: null,
      runStatus: "completed",
      sessionState: "idle",
    });
  });

  assert.equal(completedPersistCount, 1);
  assert.equal(composerSuggestionUserId, "user-1");
  assert.equal(composerSuggestionUiLocale, "es-MX");
  assert.ok(generatedImageDeadlineMs >= startedAtMs + 719_000);
  assert.ok(generatedImageDeadlineMs <= Date.now() + 720_000);
  assert.deepEqual(observedClaimTokens, Array.from({ length: 3 }, () => createParams().claimToken));
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "completed");
});

test("runPersistedChatSessionWithDeps passes low-cost model and policy metadata to runtime dependencies", async () => {
  const baseParams = createParams();
  let observedModel: string | null = null;
  let observedAiCostMode: string | null = null;
  let observedChatTurnsLast7d: number | null = null;
  let observedGoodReviewDaysLast7d: number | null = null;
  let openAIModel: string | null = null;
  let openAIReasoningEffort: string | null = null;

  const result = await runPersistedChatSessionWithDeps(
    {
      ...baseParams,
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
      diagnostics: {
        ...baseParams.diagnostics,
        model: "gpt-5.6-luna",
        aiCostMode: "low_cost",
        chatTurnsLast7d: 20,
        goodReviewDaysLast7d: 1,
      },
    },
    createDependencies({
      startChatTurnObservation: async (params, execute) => {
        observedModel = params.model;
        observedAiCostMode = params.aiCostMode;
        observedChatTurnsLast7d = params.chatTurnsLast7d;
        observedGoodReviewDaysLast7d = params.goodReviewDaysLast7d;
        await execute(null);
      },
      startOpenAILoop: async (
        params: StartOpenAILoopParams,
        _onEvent: OpenAILoopEventSink,
      ): Promise<OpenAILoopCompletion> => {
        openAIModel = params.modelId;
        openAIReasoningEffort = params.reasoningEffort;
        return {
          openaiItems: [],
          terminationReason: "completed",
        };
      },
    }),
  );

  assert.equal(result.outcome, "completed");
  assert.equal(observedModel, "gpt-5.6-luna");
  assert.equal(observedAiCostMode, "low_cost");
  assert.equal(observedChatTurnsLast7d, 20);
  assert.equal(observedGoodReviewDaysLast7d, 1);
  assert.equal(openAIModel, "gpt-5.6-luna");
  assert.equal(openAIReasoningEffort, "high");
});
