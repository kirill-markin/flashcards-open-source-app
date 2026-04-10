import { transactionWithWorkspaceScope, type DatabaseExecutor, type WorkspaceDatabaseScope } from "../../db";
import {
  buildInitialChatComposerSuggestions,
  emptyChatComposerSuggestions,
  type ChatComposerSuggestionsLocale,
  type ChatComposerSuggestion,
  type ChatComposerSuggestionInvalidationReason,
  type ChatComposerSuggestionSource,
} from "../composerSuggestions";
import { requireSessionRow, selectChatSessionForUpdateRowWithExecutor } from "./repository";
import {
  insertChatComposerSuggestionGenerationRowWithExecutor,
  invalidateChatComposerSuggestionGenerationRowWithExecutor,
  updateChatSessionActiveComposerSuggestionGenerationRowWithExecutor,
} from "./repository";

function requireNonEmptyChatComposerSuggestions(
  suggestions: ReadonlyArray<ChatComposerSuggestion>,
  operation: string,
): void {
  if (suggestions.length === 0) {
    throw new Error(`Chat composer suggestions must not be empty during ${operation}`);
  }
}

async function insertChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: Readonly<{
    sessionId: string;
    assistantItemId: string | null;
    source: ChatComposerSuggestionSource;
    suggestions: ReadonlyArray<ChatComposerSuggestion>;
  }>,
) {
  requireNonEmptyChatComposerSuggestions(params.suggestions, "generation insert");
  return insertChatComposerSuggestionGenerationRowWithExecutor(
    executor,
    scope,
    params.sessionId,
    params.assistantItemId,
    params.source,
    JSON.stringify(params.suggestions),
  );
}

async function updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  generationId: string | null,
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>,
): Promise<void> {
  const row = await updateChatSessionActiveComposerSuggestionGenerationRowWithExecutor(
    executor,
    scope,
    sessionId,
    generationId,
    JSON.stringify(composerSuggestions),
  );
  requireSessionRow(row, "activate-generation");
}

export async function activateChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  generationId: string,
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>,
): Promise<void> {
  requireNonEmptyChatComposerSuggestions(composerSuggestions, "generation activation");
  const lockedSession = await selectChatSessionForUpdateRowWithExecutor(executor, scope, sessionId);
  if (lockedSession.active_composer_suggestion_generation_id !== null) {
    throw new Error(
      `Chat session ${sessionId} already has active composer suggestion generation ${lockedSession.active_composer_suggestion_generation_id}`,
    );
  }

  await updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    sessionId,
    generationId,
    composerSuggestions,
  );
}

export async function clearActiveChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  invalidationReason: ChatComposerSuggestionInvalidationReason,
): Promise<void> {
  const lockedSession = await selectChatSessionForUpdateRowWithExecutor(executor, scope, sessionId);
  const activeGenerationId = lockedSession.active_composer_suggestion_generation_id;

  if (activeGenerationId !== null) {
    await invalidateChatComposerSuggestionGenerationRowWithExecutor(
      executor,
      scope,
      activeGenerationId,
      invalidationReason,
    );
  }

  await updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    sessionId,
    null,
    emptyChatComposerSuggestions(),
  );
}

export async function createInitialChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  uiLocale: ChatComposerSuggestionsLocale | null,
): Promise<void> {
  const suggestions = buildInitialChatComposerSuggestions(uiLocale);
  const generation = await insertChatComposerSuggestionGenerationWithExecutor(executor, scope, {
    sessionId,
    assistantItemId: null,
    source: "initial",
    suggestions,
  });
  await activateChatComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    sessionId,
    generation.generation_id,
    suggestions,
  );
}

export async function createFollowUpChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  assistantItemId: string,
  suggestions: ReadonlyArray<ChatComposerSuggestion>,
): Promise<void> {
  if (suggestions.length === 0) {
    const lockedSession = await selectChatSessionForUpdateRowWithExecutor(executor, scope, sessionId);
    if (lockedSession.active_composer_suggestion_generation_id !== null) {
      throw new Error(
        `Chat session ${sessionId} still has active composer suggestion generation ${lockedSession.active_composer_suggestion_generation_id} during empty follow-up completion`,
      );
    }

    await updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      sessionId,
      null,
      emptyChatComposerSuggestions(),
    );
    return;
  }

  const generation = await insertChatComposerSuggestionGenerationWithExecutor(executor, scope, {
    sessionId,
    assistantItemId,
    source: "assistant_follow_up",
    suggestions,
  });
  await activateChatComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    sessionId,
    generation.generation_id,
    suggestions,
  );
}

export const clearActiveChatComposerSuggestionGeneration = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  invalidationReason: ChatComposerSuggestionInvalidationReason,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      sessionId,
      invalidationReason,
    ));
