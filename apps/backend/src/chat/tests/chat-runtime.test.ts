import assert from "node:assert/strict";
import test from "node:test";
import {
  chatAttachmentUnsupportedTypeCode,
  chatAttachmentUnsupportedTypeMessage,
} from "../attachmentPolicy";
import { ChatRunRowNotFoundError } from "../errors";
import type { ChatRuntimeDependencies, StartPersistedChatRunParams } from "../runtime";
import { runPersistedChatSessionWithDeps } from "../runtime";
import type { OpenAILoopCompletion, OpenAILoopEventSink, StartOpenAILoopParams } from "../openai/loop";
import { HttpError } from "../../shared/errors";

type ConsoleMethod = "log" | "warn" | "error";
type StructuredLogRecord = Readonly<Record<string, unknown> & {
  consoleMethod: ConsoleMethod;
}>;

type DependencyOverrides = Partial<ChatRuntimeDependencies>;

type HeartbeatController = Readonly<{
  tick: () => Promise<void>;
  triggerSoftDeadline: () => Promise<void>;
}>;

type PersistAssistantTerminalErrorParams = Parameters<
  ChatRuntimeDependencies["persistAssistantTerminalError"]
>[2];

const CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS = 180_000;
const DEADLINE_REACHED_MESSAGE = "This response took too long, so I stopped the run before the server timeout. Please try again or split the request into smaller steps.";

function createCompletedLoopCompletion(): OpenAILoopCompletion {
  return {
    openaiItems: [],
    terminationReason: "completed",
  };
}

function createAbortError(): Error {
  const error = new Error("Request was aborted.");
  error.name = "AbortError";
  return error;
}

function createProviderApiError(rawMessage: string): Error & Readonly<{
  status: number;
  code: string;
  requestID: string;
}> {
  const error = new Error(rawMessage);
  error.name = "RateLimitError";
  return Object.assign(error, {
    status: 429,
    code: "rate_limit_exceeded",
    requestID: "req_provider_123",
  });
}

function createProviderInvalidFileError(rawMessage: string): Error & Readonly<{
  status: number;
  code: string;
  requestID: string;
}> {
  const error = new Error(rawMessage);
  error.name = "BadRequestError";
  return Object.assign(error, {
    status: 400,
    code: "invalid_file",
    requestID: "req_invalid_file_123",
  });
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
    getRemainingTimeInMillis: (): number => 900_000,
  };
}

function createDependencies(overrides: DependencyOverrides): ChatRuntimeDependencies {
  const dependencies: ChatRuntimeDependencies = {
    startChatTurnObservation: async (_params, execute) => execute(null),
    startOpenAILoop: async (_params, _onEvent) => createCompletedLoopCompletion(),
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
  const originalWarn = console.warn;
  const originalError = console.error;
  const records: Array<StructuredLogRecord> = [];

  const captureMessage = (message: unknown, consoleMethod: ConsoleMethod): void => {
    if (typeof message === "string") {
      records.push({
        ...(JSON.parse(message) as Record<string, unknown>),
        consoleMethod,
      });
    }
  };

  console.log = (...args: unknown[]): void => {
    captureMessage(args[0], "log");
  };
  console.error = (...args: unknown[]): void => {
    captureMessage(args[0], "error");
  };
  console.warn = (...args: unknown[]): void => {
    captureMessage(args[0], "warn");
  };

  try {
    await execute();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  return records;
}

async function withControlledHeartbeat(
  execute: (controller: HeartbeatController) => Promise<void>,
): Promise<void> {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let intervalCallback: (() => void) | null = null;
  let timeoutCallback: (() => void) | null = null;

  globalThis.setInterval = ((callback: Parameters<typeof setInterval>[0]) => {
    intervalCallback = callback as () => void;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((_timer: ReturnType<typeof setInterval>) => {
    intervalCallback = null;
  }) as typeof clearInterval;
  globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0]) => {
    timeoutCallback = callback as () => void;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((_timer: ReturnType<typeof setTimeout>) => {
    timeoutCallback = null;
  }) as typeof clearTimeout;

  try {
    await execute({
      tick: async (): Promise<void> => {
        assert.notEqual(intervalCallback, null);
        intervalCallback!();
        await Promise.resolve();
        await Promise.resolve();
      },
      triggerSoftDeadline: async (): Promise<void> => {
        assert.notEqual(timeoutCallback, null);
        timeoutCallback!();
        await Promise.resolve();
        await Promise.resolve();
      },
    });
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
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

function requireTerminalPersistParams(
  params: PersistAssistantTerminalErrorParams | null,
): PersistAssistantTerminalErrorParams {
  if (params === null) {
    throw new Error("Expected terminal persist params");
  }

  return params;
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
          return createCompletedLoopCompletion();
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

test("runPersistedChatSessionWithDeps prefers initial cancellation over an already-reached deadline", async () => {
  let startOpenAILoopCalled = false;
  let cancelledPersistCount = 0;
  let terminalPersistCount = 0;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      {
        ...createParams(),
        getRemainingTimeInMillis: (): number => CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
      },
      createDependencies({
        touchChatRunHeartbeat: async () => ({
          cancellationRequested: true,
          ownershipLost: false,
        }),
        startOpenAILoop: async () => {
          startOpenAILoopCalled = true;
          return createCompletedLoopCompletion();
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
      outcome: "cancelled",
      abortReason: "initial_cancel_state",
      runStatus: "cancelled",
      sessionState: "idle",
    });
  });

  assert.equal(startOpenAILoopCalled, false);
  assert.equal(cancelledPersistCount, 1);
  assert.equal(terminalPersistCount, 0);
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "initial_cancel_state");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted")?.runStatus, "cancelled");
});

test("runPersistedChatSessionWithDeps prefers ownership loss over an already-reached deadline", async () => {
  let startOpenAILoopCalled = false;
  let terminalPersistCount = 0;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      {
        ...createParams(),
        getRemainingTimeInMillis: (): number => CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
      },
      createDependencies({
        touchChatRunHeartbeat: async () => ({
          cancellationRequested: false,
          ownershipLost: true,
        }),
        startOpenAILoop: async () => {
          startOpenAILoopCalled = true;
          return createCompletedLoopCompletion();
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

  assert.equal(startOpenAILoopCalled, false);
  assert.equal(terminalPersistCount, 0);
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "ownership_lost");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted"), undefined);
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

test("runPersistedChatSessionWithDeps keeps ownership loss authoritative when the soft deadline fires later", async () => {
  let heartbeatCallCount = 0;
  let terminalPersistCount = 0;
  const loopStarted = createDeferredPromise<void>();
  const abortObserved = createDeferredPromise<void>();
  const allowAbortRejection = createDeferredPromise<void>();

  const logs = await withCapturedLogs(async () => {
    await withControlledHeartbeat(async ({ tick, triggerSoftDeadline }) => {
      const runtimePromise = runPersistedChatSessionWithDeps(
        {
          ...createParams(),
          getRemainingTimeInMillis: (): number => CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS + 1,
        },
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
                abortObserved.resolve(undefined);
                void allowAbortRejection.promise.then(() => {
                  reject(createAbortError());
                });
              }, { once: true });
              loopStarted.resolve();
            });
          },
          persistAssistantTerminalError: async () => {
            terminalPersistCount += 1;
          },
        }),
      );

      await loopStarted.promise;
      await tick();
      await abortObserved.promise;
      await triggerSoftDeadline();
      allowAbortRejection.resolve(undefined);

      const result = await runtimePromise;
      assert.deepEqual(result, {
        outcome: "ownership_lost",
        abortReason: "ownership_lost",
        runStatus: null,
        sessionState: null,
      });
    });
  });

  assert.equal(terminalPersistCount, 0);
  assert.equal(findLog(logs, "chat_worker_abort_requested")?.abortReason, "ownership_lost");
  assert.equal(findLog(logs, "chat_worker_provider_call_aborted")?.abortReason, "ownership_lost");
  assert.equal(findLog(logs, "chat_worker_terminal_state_persisted"), undefined);
});

test("runPersistedChatSessionWithDeps keeps user cancellation authoritative when the soft deadline fires later", async () => {
  let heartbeatCallCount = 0;
  let cancelledPersistCount = 0;
  let terminalPersistCount = 0;
  const loopStarted = createDeferredPromise<void>();
  const abortObserved = createDeferredPromise<void>();
  const allowAbortRejection = createDeferredPromise<void>();

  const logs = await withCapturedLogs(async () => {
    await withControlledHeartbeat(async ({ tick, triggerSoftDeadline }) => {
      const runtimePromise = runPersistedChatSessionWithDeps(
        {
          ...createParams(),
          getRemainingTimeInMillis: (): number => CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS + 1,
        },
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
                abortObserved.resolve(undefined);
                void allowAbortRejection.promise.then(() => {
                  reject(createAbortError());
                });
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
      await abortObserved.promise;
      await triggerSoftDeadline();
      allowAbortRejection.resolve(undefined);

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

test("runPersistedChatSessionWithDeps persists a failed run for real provider errors", async () => {
  let terminalPersistCount = 0;
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;
  const rawProviderMessage = "provider leaked raw prompt: user asked about private study notes";

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
          throw createProviderApiError(rawProviderMessage);
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistCount += 1;
          terminalPersistParams = params;
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
  assert.equal(
    requireTerminalPersistParams(terminalPersistParams).errorMessage,
    "The AI provider is rate limited right now. Please try again in a few minutes.",
  );
  assert.equal(findLog(logs, "chat_worker_provider_call_aborted"), undefined);
  const terminalLog = findLog(logs, "chat_worker_terminal_state_persisted");
  assert.equal(terminalLog?.consoleMethod, "warn");
  assert.equal(terminalLog?.runStatus, "failed");
  assert.equal(terminalLog?.providerErrorClass, "RateLimitError");
  assert.equal(terminalLog?.providerErrorMessage, null);
  assert.equal(terminalLog?.providerErrorStatus, 429);
  assert.equal(terminalLog?.providerErrorCode, "rate_limit_exceeded");
  assert.equal(terminalLog?.providerErrorCategory, "provider_rate_limited");
  assert.equal(terminalLog?.providerRequestId, "req_provider_123");
  assert.equal(terminalLog?.lambdaRequestId, "lambda-request-1");
  assert.equal(terminalLog?.errorClass, undefined);
  assert.equal(terminalLog?.errorMessage, undefined);
  assert.equal(JSON.stringify(terminalLog).includes(rawProviderMessage), false);
});

test("runPersistedChatSessionWithDeps maps provider invalid_file failures to attachment guidance", async () => {
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;
  const rawProviderMessage = "provider invalid_file response included attachment details";

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      createParams(),
      createDependencies({
        startOpenAILoop: async (): Promise<OpenAILoopCompletion> => {
          throw createProviderInvalidFileError(rawProviderMessage);
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistParams = params;
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

  assert.equal(
    requireTerminalPersistParams(terminalPersistParams).errorMessage,
    chatAttachmentUnsupportedTypeMessage,
  );
  const terminalLog = findLog(logs, "chat_worker_terminal_state_persisted");
  assert.equal(terminalLog?.consoleMethod, "warn");
  assert.equal(terminalLog?.providerErrorClass, "BadRequestError");
  assert.equal(terminalLog?.providerErrorMessage, null);
  assert.equal(terminalLog?.providerErrorStatus, 400);
  assert.equal(terminalLog?.providerErrorCode, "invalid_file");
  assert.equal(terminalLog?.providerErrorCategory, "provider_error");
  assert.equal(terminalLog?.providerRequestId, "req_invalid_file_123");
  assert.equal(terminalLog?.errorClass, undefined);
  assert.equal(terminalLog?.errorMessage, undefined);
  assert.equal(JSON.stringify(terminalLog).includes(rawProviderMessage), false);
});

test("runPersistedChatSessionWithDeps maps local attachment validation failures to attachment guidance", async () => {
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      createParams(),
      createDependencies({
        startOpenAILoop: async (): Promise<OpenAILoopCompletion> => {
          throw new HttpError(
            400,
            chatAttachmentUnsupportedTypeMessage,
            chatAttachmentUnsupportedTypeCode,
          );
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistParams = params;
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

  assert.equal(
    requireTerminalPersistParams(terminalPersistParams).errorMessage,
    chatAttachmentUnsupportedTypeMessage,
  );
  const terminalLog = findLog(logs, "chat_worker_terminal_state_persisted");
  assert.equal(terminalLog?.consoleMethod, "warn");
  assert.equal(terminalLog?.providerErrorMessage, null);
  assert.equal(terminalLog?.errorClass, undefined);
  assert.equal(terminalLog?.errorMessage, undefined);
});

test("runPersistedChatSessionWithDeps captures unexpected runtime failures as backend exceptions", async () => {
  const runtimeError = new Error("assistant content reducer exploded");
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      createParams(),
      createDependencies({
        startOpenAILoop: async (): Promise<OpenAILoopCompletion> => {
          throw runtimeError;
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistParams = params;
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

  assert.equal(
    requireTerminalPersistParams(terminalPersistParams).errorMessage,
    "The AI response failed before it could finish. Please try again.",
  );
  const terminalLogs = logs.filter((record) => record.action === "chat_worker_terminal_state_persisted");
  assert.equal(terminalLogs.length, 1);
  const terminalLog = terminalLogs[0];
  assert.equal(terminalLog?.consoleMethod, "error");
  assert.equal(terminalLog?.runStatus, "failed");
  assert.equal(terminalLog?.providerErrorCategory, "runtime_error");
  assert.equal(terminalLog?.errorClass, "Error");
  assert.equal(terminalLog?.errorMessage, "assistant content reducer exploded");
  assert.equal(terminalLog?.lambdaRequestId, "lambda-request-1");
});

test("runPersistedChatSessionWithDeps does not log raw provider terminal event messages", async () => {
  const rawProviderMessage = "provider terminal event included private prompt text";
  let terminalPersistParams: PersistAssistantTerminalErrorParams | null = null;

  const logs = await withCapturedLogs(async () => {
    const result = await runPersistedChatSessionWithDeps(
      createParams(),
      createDependencies({
        startOpenAILoop: async (
          _params: StartOpenAILoopParams,
          onEvent: OpenAILoopEventSink,
        ): Promise<OpenAILoopCompletion> => {
          await onEvent({
            type: "error",
            message: rawProviderMessage,
          });
          return createCompletedLoopCompletion();
        },
        persistAssistantTerminalError: async (_userId, _workspaceId, params) => {
          terminalPersistParams = params;
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

  assert.equal(
    requireTerminalPersistParams(terminalPersistParams).errorMessage,
    "The AI provider could not complete the response. Please try again.",
  );
  const terminalLog = findLog(logs, "chat_worker_terminal_state_persisted");
  assert.equal(terminalLog?.consoleMethod, "warn");
  assert.equal(terminalLog?.providerErrorClass, "ChatProviderTerminalEventError");
  assert.equal(terminalLog?.providerErrorMessage, null);
  assert.equal(terminalLog?.providerErrorCategory, "provider_error");
  assert.equal(terminalLog?.errorClass, undefined);
  assert.equal(terminalLog?.errorMessage, undefined);
  assert.equal(JSON.stringify(terminalLog).includes(rawProviderMessage), false);
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

test("runPersistedChatSessionWithDeps completes a successful run and persists completion once", async () => {
  let completedPersistCount = 0;
  let composerSuggestionUserId: string | null = null;
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
  assert.equal(composerSuggestionUserId, "user-1");
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
