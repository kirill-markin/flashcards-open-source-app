import assert from "node:assert/strict";
import type {
  ChatRuntimeDependencies,
  StartPersistedChatRunParams,
} from "../../runtime";
import type {
  OpenAILoopCompletion,
} from "../../openai/loop";

type ConsoleMethod = "log" | "warn" | "error";
type StructuredLogRecord = Readonly<Record<string, unknown> & {
  consoleMethod: ConsoleMethod;
}>;

export type DependencyOverrides = Partial<ChatRuntimeDependencies>;

export type HeartbeatController = Readonly<{
  tick: () => Promise<void>;
  triggerSoftDeadline: () => Promise<void>;
}>;

export type PersistAssistantTerminalErrorParams = Parameters<
  ChatRuntimeDependencies["persistAssistantTerminalError"]
>[2];

export const CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS = 180_000;
export const DEADLINE_REACHED_MESSAGE = "This response took too long, so I stopped the run before the server timeout. Please try again or split the request into smaller steps.";

export function createCompletedLoopCompletion(): OpenAILoopCompletion {
  return {
    openaiItems: [],
    terminationReason: "completed",
  };
}

export function createAbortError(): Error {
  const error = new Error("Request was aborted.");
  error.name = "AbortError";
  return error;
}

export function createProviderApiError(rawMessage: string): Error & Readonly<{
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

export function createProviderInvalidFileError(rawMessage: string): Error & Readonly<{
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

export function createParams(): StartPersistedChatRunParams {
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

export function createDependencies(overrides: DependencyOverrides): ChatRuntimeDependencies {
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

export async function withCapturedLogs(
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

export async function withControlledHeartbeat(
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

export function createDeferredPromise<T>(): Readonly<{
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

export function findLog(
  records: ReadonlyArray<StructuredLogRecord>,
  action: string,
): StructuredLogRecord | undefined {
  return records.find((record) => record.action === action);
}

export function requireTerminalPersistParams(
  params: PersistAssistantTerminalErrorParams | null,
): PersistAssistantTerminalErrorParams {
  if (params === null) {
    throw new Error("Expected terminal persist params");
  }

  return params;
}
