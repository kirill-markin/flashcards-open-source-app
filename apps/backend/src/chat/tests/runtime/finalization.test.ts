import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatRunRowNotFoundError,
} from "../../errors";
import {
  runPersistedChatSessionWithDeps,
} from "../../runtime";
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
