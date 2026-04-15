import assert from "node:assert/strict";
import test from "node:test";
import { ChatRunRowNotFoundError } from "../errors";
import type { ChatRuntimeDependencies, StartPersistedChatRunParams } from "../runtime";
import { runPersistedChatSessionWithDeps } from "../runtime";
import type { OpenAILoopCompletion, OpenAILoopEventSink, StartOpenAILoopParams } from "../openai/loop";

type StructuredLogRecord = Readonly<Record<string, unknown>>;

type DependencyOverrides = Partial<ChatRuntimeDependencies>;

type HeartbeatController = Readonly<{
  tick: () => Promise<void>;
}>;

function createAbortError(): Error {
  const error = new Error("Request was aborted.");
  error.name = "AbortError";
  return error;
}

function createParams(): StartPersistedChatRunParams {
  return {
    lambdaRequestId: "lambda-request-1",
    runId: "run-1",
    requestId: "chat-request-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    timezone: "Europe/Madrid",
    uiLocale: "es-MX",
    assistantItemId: "assistant-item-1",
    localMessages: [],
    turnInput: [{ type: "text", text: "hello" }],
    diagnostics: {
      requestId: "chat-request-1",
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

function createDependencies(overrides: DependencyOverrides): ChatRuntimeDependencies {
  const dependencies: ChatRuntimeDependencies = {
    startChatTurnObservation: async (_params, execute) => execute(null),
    startOpenAILoop: async (_params, _onEvent) => ({
      openaiItems: [],
    }),
    generateFollowUpChatComposerSuggestions: async () => [],
    completeChatRun: async () => undefined,
    persistAssistantCancelled: async () => undefined,
    persistAssistantTerminalError: async () => undefined,
    touchChatRunHeartbeat: async () => ({
      cancellationRequested: false,
      ownershipLost: false,
    }),
    updateAssistantMessageItem: async (_userId, _workspaceId, params) => ({
      itemId: params.itemId,
      sessionId: "session-1",
      itemOrder: 1,
      role: "assistant",
      content: params.content,
      state: params.state,
      isError: params.state === "error",
      isStopped: params.state === "cancelled",
      timestamp: 1,
      updatedAt: 1,
    }),
    updateAssistantMessageItemAndInvalidateMainContent: async () => 1,
    beginTaskProtection: async () => undefined,
    endTaskProtection: async () => undefined,
  };

  return {
    ...dependencies,
    ...overrides,
  };
}

async function withCapturedLogs(
  execute: () => Promise<void>,
): Promise<ReadonlyArray<StructuredLogRecord>> {
  const originalLog = console.log;
  const originalError = console.error;
  const records: Array<StructuredLogRecord> = [];

  console.log = (...args: unknown[]): void => {
    const message = args[0];
    if (typeof message === "string") {
      records.push(JSON.parse(message) as StructuredLogRecord);
    }
  };
  console.error = (...args: unknown[]): void => {
    const message = args[0];
    if (typeof message === "string") {
      records.push(JSON.parse(message) as StructuredLogRecord);
    }
  };

  try {
    await execute();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return records;
}

async function withControlledHeartbeat(
  execute: (controller: HeartbeatController) => Promise<void>,
): Promise<void> {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let intervalCallback: (() => void) | null = null;

  globalThis.setInterval = ((callback: Parameters<typeof setInterval>[0]) => {
    intervalCallback = callback as () => void;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((_timer: ReturnType<typeof setInterval>) => {
    intervalCallback = null;
  }) as typeof clearInterval;

  try {
    await execute({
      tick: async (): Promise<void> => {
        assert.notEqual(intervalCallback, null);
        intervalCallback!();
        await Promise.resolve();
        await Promise.resolve();
      },
    });
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

function createDeferredPromise<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}> {
  let resolveFn: ((value: T | PromiseLike<T>) => void) | null = null;
  let rejectFn: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      assert.notEqual(resolveFn, null);
      resolveFn!(value);
    },
    reject: (reason) => {
      assert.notEqual(rejectFn, null);
      rejectFn!(reason);
    },
  };
}

function findLog(
  records: ReadonlyArray<StructuredLogRecord>,
  action: string,
): StructuredLogRecord | undefined {
  return records.find((record) => record.action === action);
}

test("runPersistedChatSessionWithDeps finalizes a cancelled run when the user stops during the provider call", async () => {
  let heartbeatCallCount = 0;
  let cancelledPersistCount = 0;
  let terminalPersistCount = 0;
  const loopStarted = createDeferredPromise<void>();

  const logs = await withCapturedLogs(async () => {
    await withControlledHeartbeat(async ({ tick }) => {
      const runtimePromise = runPersistedChatSessionWithDeps(
        createParams(),
        createDependencies({
          touchChatRunHeartbeat: async () => {
            heartbeatCallCount += 1;
            if (heartbeatCallCount === 1) {
              return {
                cancellationRequested: false,
                ownershipLost: false,
              };
            }

            return {
              cancellationRequested: true,
              ownershipLost: false,
            };
          },
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

            return new Promise<OpenAILoopCompletion>((_resolve, reject) => {
              params.signal?.addEventListener("abort", () => {
                reject(createAbortError());
              }, { once: true });
              loopStarted.resolve();
            });
          },
          persistAssistantCancelled: async () => {
            cancelledPersistCount += 1;
          },
          persistAssistantTerminalError: async () => {
            terminalPersistCount += 1;
          },
        }),
      );

      await loopStarted.promise;
      await tick();

      const result = await runtimePromise;
      assert.deepEqual(result, {
        outcome: "cancelled",
        abortReason: "user_cancelled",
        runStatus: "cancelled",
        sessionState: "idle",
      });
    });
  });

  assert.equal(cancelledPersistCount, 1);
  assert.equal(terminalPersistCount, 0);
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "user_cancelled");
  assert.equal(findLog(logs, "chat_worker_provider_call_aborted")?.abortReason, "user_cancelled");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "cancelled");
});

test("runPersistedChatSessionWithDeps cancels immediately when the run was already cancelled before provider work starts", async () => {
  let startOpenAILoopCalled = false;
  let cancelledPersistCount = 0;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      createParams(),
      createDependencies({
        touchChatRunHeartbeat: async () => ({
          cancellationRequested: true,
          ownershipLost: false,
        }),
        startOpenAILoop: async () => {
          startOpenAILoopCalled = true;
          return { openaiItems: [] };
        },
        persistAssistantCancelled: async () => {
          cancelledPersistCount += 1;
        },
      }),
    );

    assert.deepEqual(result, {
      outcome: "cancelled",
      abortReason: "initial_cancel_state",
      runStatus: "cancelled",
      sessionState: "idle",
    });
  });

  assert.equal(startOpenAILoopCalled, false);
  assert.equal(cancelledPersistCount, 1);
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "initial_cancel_state");
  assert.equal(findLog(logs, "chat_worker_provider_call_started"), undefined);
});

test("runPersistedChatSessionWithDeps exits without persisting a terminal state after ownership loss", async () => {
  let heartbeatCallCount = 0;
  let cancelledPersistCount = 0;
  let terminalPersistCount = 0;
  const loopStarted = createDeferredPromise<void>();

  const logs = await withCapturedLogs(async () => {
    await withControlledHeartbeat(async ({ tick }) => {
      const runtimePromise = runPersistedChatSessionWithDeps(
        createParams(),
        createDependencies({
          touchChatRunHeartbeat: async () => {
            heartbeatCallCount += 1;
            if (heartbeatCallCount === 1) {
              return {
                cancellationRequested: false,
                ownershipLost: false,
              };
            }

            return {
              cancellationRequested: false,
              ownershipLost: true,
            };
          },
          startOpenAILoop: async (
            params: StartOpenAILoopParams,
            _onEvent: OpenAILoopEventSink,
          ): Promise<OpenAILoopCompletion> => {
            return new Promise<OpenAILoopCompletion>((_resolve, reject) => {
              params.signal?.addEventListener("abort", () => {
                reject(createAbortError());
              }, { once: true });
              loopStarted.resolve();
            });
          },
          persistAssistantCancelled: async () => {
            cancelledPersistCount += 1;
          },
          persistAssistantTerminalError: async () => {
            terminalPersistCount += 1;
          },
        }),
      );

      await loopStarted.promise;
      await tick();

      const result = await runtimePromise;
      assert.deepEqual(result, {
        outcome: "ownership_lost",
        abortReason: "ownership_lost",
        runStatus: null,
        sessionState: null,
      });
    });
  });

  assert.equal(cancelledPersistCount, 0);
  assert.equal(terminalPersistCount, 0);
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "ownership_lost");
  assert.equal(findLog(logs, "chat_worker_provider_call_aborted")?.abortReason, "ownership_lost");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted"), undefined);
});

test("runPersistedChatSessionWithDeps persists a failed run for real provider errors", async () => {
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
          throw new Error("provider exploded");
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

  assert.equal(terminalPersistCount, 1);
  assert.equal(findLog(logs, "chat_worker_provider_call_aborted"), undefined);
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "failed");
});

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

test("runPersistedChatSessionWithDeps completes a successful run and persists completion once", async () => {
  let completedPersistCount = 0;
  let composerSuggestionUiLocale: string | null | undefined = undefined;

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
            text: "done",
            itemId: "assistant-item-1",
            outputIndex: 0,
            contentIndex: 0,
            sequenceNumber: 1,
          });
          return {
            openaiItems: [],
          };
        },
        generateFollowUpChatComposerSuggestions: async (
          _userContent,
          _assistantContent,
          _assistantItemId,
          uiLocale,
        ) => {
          composerSuggestionUiLocale = uiLocale;
          return [];
        },
        completeChatRun: async () => {
          completedPersistCount += 1;
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
  assert.equal(composerSuggestionUiLocale, "es-MX");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "completed");
});

test("runPersistedChatSessionWithDeps handles the original abort race without surfacing a detached rejection", async () => {
  let heartbeatCallCount = 0;
  const loopStarted = createDeferredPromise<void>();

  const result = await withCapturedLogs(async () => {
    await withControlledHeartbeat(async ({ tick }) => {
      const runtimePromise = runPersistedChatSessionWithDeps(
        createParams(),
        createDependencies({
          touchChatRunHeartbeat: async () => {
            heartbeatCallCount += 1;
            if (heartbeatCallCount === 1) {
              return {
                cancellationRequested: false,
                ownershipLost: false,
              };
            }

            return {
              cancellationRequested: true,
              ownershipLost: false,
            };
          },
          startOpenAILoop: async (
            params: StartOpenAILoopParams,
            _onEvent: OpenAILoopEventSink,
          ): Promise<OpenAILoopCompletion> => {
            return new Promise<OpenAILoopCompletion>((_resolve, reject) => {
              params.signal?.addEventListener("abort", () => {
                reject(createAbortError());
              }, { once: true });
              loopStarted.resolve();
            });
          },
        }),
      );

      await loopStarted.promise;
      await tick();

      assert.deepEqual(await runtimePromise, {
        outcome: "cancelled",
        abortReason: "user_cancelled",
        runStatus: "cancelled",
        sessionState: "idle",
      });
    });
  });

  assert.equal(findLog(result, "chat_worker_provider_call_aborted")?.abortReason, "user_cancelled");
});
