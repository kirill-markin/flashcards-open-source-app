import assert from "node:assert/strict";
import test from "node:test";
import {
  chatAttachmentUnsupportedTypeCode,
  chatAttachmentUnsupportedTypeMessage,
} from "../../attachmentPolicy";
import {
  runPersistedChatSessionWithDeps,
} from "../../runtime";
import type {
  OpenAILoopCompletion,
  OpenAILoopEventSink,
  StartOpenAILoopParams,
} from "../../openai/loop";
import {
  HttpError,
} from "../../../shared/errors";
import {
  type PersistAssistantTerminalErrorParams,
  createCompletedLoopCompletion,
  createDependencies,
  createParams,
  createProviderApiError,
  createProviderInvalidFileError,
  findLog,
  requireTerminalPersistParams,
  withCapturedLogs,
} from "./testSupport";

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
    "The AI service is rate limited right now. Please try again in a few minutes.",
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
    "The AI service could not complete the response. Please try again.",
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
