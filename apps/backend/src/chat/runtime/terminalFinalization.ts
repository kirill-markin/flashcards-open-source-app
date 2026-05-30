import {
  emptyChatComposerSuggestions,
  type ChatComposerSuggestion,
} from "../composerSuggestions";
import type {
  StoredOpenAIReplayItem,
} from "../openai/replayItems";
import type {
  ContentPart,
} from "../types";
import {
  logChatWorkerLifecycleEvent,
  type ChatWorkerLogContext,
} from "../worker/logging";
import {
  createSafeProviderErrorDetails,
  createPublicTerminalErrorMessage,
} from "./providerErrors";
import {
  finalizeAssistantToolCalls,
} from "./assistantContent";
import {
  logTerminalStatePersisted,
} from "./lifecycleLogs";
import type {
  ChatRuntimeDependencies,
} from "./dependencies";
import type {
  ChatWorkerAbortReason,
  ChatWorkerRunResult,
  StartPersistedChatRunParams,
} from "./types";

type TerminalFinalizationBaseParams = Readonly<{
  params: StartPersistedChatRunParams;
  dependencies: ChatRuntimeDependencies;
  logContext: ChatWorkerLogContext;
  startedAt: Date;
  assistantContent: ReadonlyArray<ContentPart>;
  readLifecycleState: () => TerminalFinalizationLifecycleState;
}>;

type TerminalFinalizationLifecycleState = Readonly<{
  abortReason: ChatWorkerAbortReason | null;
  signalAborted: boolean;
  stopRequestedByUser: boolean;
  ownershipLost: boolean;
}>;

type TerminalFinalizationResult = Readonly<{
  assistantContent: ReadonlyArray<ContentPart>;
  result: ChatWorkerRunResult;
}>;

async function generateTerminalComposerSuggestions(
  params: StartPersistedChatRunParams,
  assistantContent: ReadonlyArray<ContentPart>,
  logContext: ChatWorkerLogContext,
  dependencies: ChatRuntimeDependencies,
): Promise<ReadonlyArray<ChatComposerSuggestion>> {
  try {
    return await dependencies.generateFollowUpChatComposerSuggestions(
      params.userId,
      params.turnInput,
      assistantContent,
      params.assistantItemId,
      params.uiLocale,
    );
  } catch (error) {
    logChatWorkerLifecycleEvent("chat_worker_composer_suggestions_failed", logContext, {
      abortReason: null,
      signalAborted: false,
      cancellationRequested: false,
      ownershipLost: false,
      runStatus: null,
      sessionState: null,
      ...createSafeProviderErrorDetails(error),
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      outcome: null,
    }, true);
    return emptyChatComposerSuggestions();
  }
}

export async function persistCancelledChatRun(
  input: TerminalFinalizationBaseParams & Readonly<{
    reason: ChatWorkerAbortReason;
  }>,
): Promise<TerminalFinalizationResult> {
  const assistantContent = finalizeAssistantToolCalls(input.assistantContent);
  const finishedAt = new Date();
  await input.dependencies.persistAssistantCancelled(input.params.userId, input.params.workspaceId, {
    runId: input.params.runId,
    sessionId: input.params.sessionId,
    assistantItemId: input.params.assistantItemId,
    assistantContent,
  });
  const lifecycleState = input.readLifecycleState();
  logTerminalStatePersisted(
    input.logContext,
    null,
    input.reason,
    lifecycleState.signalAborted,
    "cancelled",
    "idle",
    lifecycleState.stopRequestedByUser,
    lifecycleState.ownershipLost,
    input.startedAt,
    finishedAt,
  );
  return {
    assistantContent,
    result: {
      outcome: "cancelled",
      abortReason: input.reason,
      runStatus: "cancelled",
      sessionState: "idle",
    },
  };
}

export async function persistFailedChatRun(
  input: TerminalFinalizationBaseParams & Readonly<{
    error: unknown;
  }>,
): Promise<TerminalFinalizationResult> {
  const assistantContent = finalizeAssistantToolCalls(input.assistantContent);
  const finishedAt = new Date();
  await input.dependencies.persistAssistantTerminalError(input.params.userId, input.params.workspaceId, {
    runId: input.params.runId,
    sessionId: input.params.sessionId,
    assistantItemId: input.params.assistantItemId,
    assistantContent,
    errorMessage: createPublicTerminalErrorMessage(input.error),
    sessionState: "idle",
  });
  const lifecycleState = input.readLifecycleState();
  logTerminalStatePersisted(
    input.logContext,
    input.error,
    lifecycleState.abortReason,
    lifecycleState.signalAborted,
    "failed",
    "idle",
    lifecycleState.stopRequestedByUser,
    lifecycleState.ownershipLost,
    input.startedAt,
    finishedAt,
  );
  return {
    assistantContent,
    result: {
      outcome: "failed",
      abortReason: lifecycleState.abortReason,
      runStatus: "failed",
      sessionState: "idle",
    },
  };
}

export async function persistInterruptedChatRun(
  input: TerminalFinalizationBaseParams & Readonly<{
    errorMessage: string;
    assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem> | undefined;
  }>,
): Promise<TerminalFinalizationResult> {
  const assistantContent = finalizeAssistantToolCalls(input.assistantContent);
  const finishedAt = new Date();
  await input.dependencies.persistAssistantTerminalError(input.params.userId, input.params.workspaceId, {
    runId: input.params.runId,
    sessionId: input.params.sessionId,
    assistantItemId: input.params.assistantItemId,
    assistantContent,
    assistantOpenAIItems: input.assistantOpenAIItems,
    errorMessage: input.errorMessage,
    sessionState: "interrupted",
  });
  const lifecycleState = input.readLifecycleState();
  logTerminalStatePersisted(
    input.logContext,
    null,
    lifecycleState.abortReason,
    lifecycleState.signalAborted,
    "interrupted",
    "interrupted",
    lifecycleState.stopRequestedByUser,
    lifecycleState.ownershipLost,
    input.startedAt,
    finishedAt,
  );
  return {
    assistantContent,
    result: {
      outcome: "interrupted",
      abortReason: lifecycleState.abortReason,
      runStatus: "interrupted",
      sessionState: "interrupted",
    },
  };
}

export async function persistCompletedChatRun(
  input: TerminalFinalizationBaseParams & Readonly<{
    assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem>;
  }>,
): Promise<TerminalFinalizationResult> {
  const assistantContent = finalizeAssistantToolCalls(input.assistantContent);
  const composerSuggestions = await generateTerminalComposerSuggestions(
    input.params,
    assistantContent,
    input.logContext,
    input.dependencies,
  );
  const finishedAt = new Date();
  await input.dependencies.completeChatRun(input.params.userId, input.params.workspaceId, {
    runId: input.params.runId,
    sessionId: input.params.sessionId,
    assistantItemId: input.params.assistantItemId,
    assistantContent,
    assistantOpenAIItems: input.assistantOpenAIItems,
    composerSuggestions,
  });
  const lifecycleState = input.readLifecycleState();
  logTerminalStatePersisted(
    input.logContext,
    null,
    null,
    lifecycleState.signalAborted,
    "completed",
    "idle",
    lifecycleState.stopRequestedByUser,
    lifecycleState.ownershipLost,
    input.startedAt,
    finishedAt,
  );
  return {
    assistantContent,
    result: {
      outcome: "completed",
      abortReason: null,
      runStatus: "completed",
      sessionState: "idle",
    },
  };
}
