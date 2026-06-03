import assert from "node:assert/strict";
import test from "node:test";
import {
  runPersistedChatSessionWithDeps,
} from "../../runtime";
import type {
  OpenAILoopCompletion,
  OpenAILoopEventSink,
  StartOpenAILoopParams,
} from "../../openai/loop";
import {
  CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS,
  createAbortError,
  createCompletedLoopCompletion,
  createDeferredPromise,
  createDependencies,
  createParams,
  findLog,
  withCapturedLogs,
  withControlledHeartbeat,
} from "./testSupport";

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
