/**
 * Canonical backend operation layer for external AI-agent tools.
 *
 * This module owns the backend business behavior that used to live inline in
 * `apps/backend/src/routes/agent.ts`. That route file should stay transport
 * focused: auth, request parsing, workspace selection, envelope shaping, and
 * next-action hints. The backend tool behavior itself lives here.
 *
 * Local browser and iOS runtimes intentionally mirror parts of this behavior
 * against local state instead of the backend database:
 * - `apps/web/src/chat/localToolExecutor.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`
 *
 * The shared TypeScript contract layer for names, schemas, validators, and
 * prompt examples lives in `apps/backend/src/aiTools/sharedToolContracts.ts`.
 */
import { randomUUID } from "node:crypto";
import {
  createCards,
  deleteCards,
  getCards,
  listReviewHistoryPage,
  listReviewQueuePage,
  listWorkspaceTagsSummary,
  queryCardsPage,
  summarizeDeckState,
  updateCards,
  type BulkCreateCardItem,
  type BulkDeleteCardItem,
  type BulkUpdateCardItem,
  type CreateCardInput,
  type DeckSummary,
  type UpdateCardInput,
  type WorkspaceTagsSummary,
} from "../cards";
import {
  createDecks,
  deleteDecks,
  getDecks,
  listDecksPage,
  searchDecksPage,
  updateDecks,
  type BulkCreateDeckItem,
  type BulkDeleteDeckItem,
  type BulkUpdateDeckItem,
  type CreateDeckInput,
  type Deck,
  type UpdateDeckInput,
} from "../decks";
import { HttpError } from "../errors";
import { EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT } from "../externalAgentTools";
import { ensureAgentSyncDevice } from "../agentSyncIdentity";
import {
  getWorkspaceSchedulerSettings,
  type WorkspaceSchedulerSettings,
} from "../workspaceSchedulerSettings";
import {
  listUserWorkspacesForSelectedWorkspace,
  type WorkspaceSummary,
} from "../workspaces";
import type {
  AgentToolCreateCardsInput,
  AgentToolCreateDecksInput,
  AgentToolCursorInput,
  AgentToolDeleteCardsInput,
  AgentToolDeleteDecksInput,
  AgentToolGetCardsInput,
  AgentToolGetDecksInput,
  AgentToolListReviewHistoryInput,
  AgentToolSearchCardsInput,
  AgentToolSearchDecksInput,
  AgentToolUpdateCardBody,
  AgentToolUpdateCardsInput,
  AgentToolUpdateDeckBody,
  AgentToolUpdateDecksInput,
  SharedAiToolName,
} from "./sharedToolContracts";

export type AgentToolOperationDependencies = Readonly<{
  createCards: typeof createCards;
  deleteCards: typeof deleteCards;
  getCards: typeof getCards;
  listReviewHistoryPage: typeof listReviewHistoryPage;
  listReviewQueuePage: typeof listReviewQueuePage;
  listWorkspaceTagsSummary: typeof listWorkspaceTagsSummary;
  queryCardsPage: typeof queryCardsPage;
  summarizeDeckState: typeof summarizeDeckState;
  updateCards: typeof updateCards;
  ensureAgentSyncDevice: typeof ensureAgentSyncDevice;
  createDecks: typeof createDecks;
  deleteDecks: typeof deleteDecks;
  getDecks: typeof getDecks;
  listDecksPage: typeof listDecksPage;
  searchDecksPage: typeof searchDecksPage;
  updateDecks: typeof updateDecks;
  getWorkspaceSchedulerSettings: typeof getWorkspaceSchedulerSettings;
  listUserWorkspacesForSelectedWorkspace: typeof listUserWorkspacesForSelectedWorkspace;
}>;

type AgentMutationContext = Readonly<{
  workspaceId: string;
  userId: string;
  connectionId: string;
  actionName: SharedAiToolName;
}>;

type WorkspaceScopedLimitInput = Readonly<{
  workspaceId: string;
  cursor: string | null;
  limit: number;
}>;

type WorkspaceScopedSearchInput = Readonly<{
  workspaceId: string;
  query: string;
  cursor: string | null;
  limit: number;
}>;

type WorkspaceContextInput = Readonly<{
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
}>;

type WorkspaceScopedGetCardsInput = Readonly<{
  workspaceId: string;
  cardIds: ReadonlyArray<string>;
}>;

type WorkspaceScopedGetDecksInput = Readonly<{
  workspaceId: string;
  deckIds: ReadonlyArray<string>;
}>;

type WorkspaceScopedReviewHistoryInput = Readonly<{
  workspaceId: string;
  cursor: string | null;
  limit: number;
  cardId: string | null;
}>;

type CreateCardsOperationInput = AgentMutationContext & Readonly<{
  cards: AgentToolCreateCardsInput["cards"];
}>;

type UpdateCardsOperationInput = AgentMutationContext & Readonly<{
  updates: AgentToolUpdateCardsInput["updates"];
}>;

type DeleteCardsOperationInput = AgentMutationContext & Readonly<{
  cardIds: AgentToolDeleteCardsInput["cardIds"];
}>;

type CreateDecksOperationInput = AgentMutationContext & Readonly<{
  decks: AgentToolCreateDecksInput["decks"];
}>;

type UpdateDecksOperationInput = AgentMutationContext & Readonly<{
  updates: AgentToolUpdateDecksInput["updates"];
}>;

type DeleteDecksOperationInput = AgentMutationContext & Readonly<{
  deckIds: AgentToolDeleteDecksInput["deckIds"];
}>;

type AgentWorkspaceContextPayload = Readonly<{
  workspace: WorkspaceSummary;
  deckSummary: DeckSummary;
  schedulerSettings: WorkspaceSchedulerSettings;
}>;

type AgentWorkspaceTagsPayload = WorkspaceTagsSummary;

type AgentLimitedCardsPayload = Readonly<{
  cards: Awaited<ReturnType<typeof queryCardsPage>>["cards"];
  nextCursor: string | null;
}>;

type AgentGetCardsPayload = Readonly<{
  cards: Awaited<ReturnType<typeof getCards>>;
  returnedCount: number;
}>;

type AgentLimitedDecksPayload = Readonly<{
  decks: Awaited<ReturnType<typeof listDecksPage>>["decks"];
  nextCursor: string | null;
}>;

type AgentGetDecksPayload = Readonly<{
  decks: Awaited<ReturnType<typeof getDecks>>;
  returnedCount: number;
}>;

type AgentReviewHistoryPayload = Readonly<{
  history: Awaited<ReturnType<typeof listReviewHistoryPage>>["history"];
  nextCursor: string | null;
}>;

type AgentCreateCardsPayload = Readonly<{
  cards: Awaited<ReturnType<typeof createCards>>;
  createdCount: number;
}>;

type AgentUpdateCardsPayload = Readonly<{
  cards: Awaited<ReturnType<typeof updateCards>>;
  updatedCount: number;
}>;

type AgentCreateDecksPayload = Readonly<{
  decks: Awaited<ReturnType<typeof createDecks>>;
  createdCount: number;
}>;

type AgentUpdateDecksPayload = Readonly<{
  decks: Awaited<ReturnType<typeof updateDecks>>;
  updatedCount: number;
}>;

type MutationMetadata = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
}>;

export const DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES: AgentToolOperationDependencies = Object.freeze({
  createCards,
  deleteCards,
  getCards,
  listReviewHistoryPage,
  listReviewQueuePage,
  listWorkspaceTagsSummary,
  queryCardsPage,
  summarizeDeckState,
  updateCards,
  ensureAgentSyncDevice,
  createDecks,
  deleteDecks,
  getDecks,
  listDecksPage,
  searchDecksPage,
  updateDecks,
  getWorkspaceSchedulerSettings,
  listUserWorkspacesForSelectedWorkspace,
});

/**
 * Validates the explicit external-agent page size.
 */
export function normalizeAgentToolLimit(limit: number): number {
  if (limit < 1 || limit > EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT) {
    throw new HttpError(400, `limit must be an integer between 1 and ${EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT}`);
  }

  return limit;
}

function createMutationOperationId(actionName: SharedAiToolName, index: number): string {
  return `${actionName}-${index}-${randomUUID()}`;
}

/**
 * Creates deterministic mutation metadata for backend-executed tool writes.
 * The transport adapter owns auth and request parsing; this layer owns the
 * metadata shape that card and deck mutation helpers require.
 */
async function buildAgentMutationMetadata(
  dependencies: AgentToolOperationDependencies,
  context: AgentMutationContext,
  count: number,
): Promise<ReadonlyArray<MutationMetadata>> {
  const deviceId = await dependencies.ensureAgentSyncDevice(
    context.workspaceId,
    context.userId,
    context.connectionId,
  );
  const clientUpdatedAt = new Date().toISOString();

  return Array.from({ length: count }, (_, index) => ({
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: createMutationOperationId(context.actionName, index),
  }));
}

/**
 * Resolves the currently selected workspace summary from the user's visible
 * workspaces. This keeps route code free from workspace list traversal.
 */
async function loadSelectedWorkspaceSummary(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceContextInput,
): Promise<WorkspaceSummary> {
  const workspaces = await dependencies.listUserWorkspacesForSelectedWorkspace(
    input.userId,
    input.selectedWorkspaceId,
  );
  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === input.workspaceId);
  if (selectedWorkspace === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return selectedWorkspace;
}

function toCreateCardInput(item: AgentToolCreateCardsInput["cards"][number]): CreateCardInput {
  return {
    frontText: item.frontText,
    backText: item.backText,
    tags: item.tags,
    effortLevel: item.effortLevel,
  };
}

function toUpdateCardInput(item: AgentToolUpdateCardBody): UpdateCardInput {
  return {
    ...(item.frontText !== null ? { frontText: item.frontText } : {}),
    ...(item.backText !== null ? { backText: item.backText } : {}),
    ...(item.tags !== null ? { tags: item.tags } : {}),
    ...(item.effortLevel !== null ? { effortLevel: item.effortLevel } : {}),
  };
}

function toCreateDeckInput(item: AgentToolCreateDecksInput["decks"][number]): CreateDeckInput {
  return {
    name: item.name,
    filterDefinition: {
      version: 2,
      effortLevels: item.effortLevels,
      tags: item.tags,
    },
  };
}

function toUpdateDeckInput(item: AgentToolUpdateDeckBody, currentDeck: Deck): UpdateDeckInput {
  return {
    name: item.name ?? currentDeck.name,
    filterDefinition: {
      version: 2,
      effortLevels: item.effortLevels ?? currentDeck.filterDefinition.effortLevels,
      tags: item.tags ?? currentDeck.filterDefinition.tags,
    },
  };
}

/**
 * Canonical backend implementation of the external `get_workspace_context`
 * tool. Browser-local and iOS-local mirrors live in
 * `apps/web/src/chat/localToolExecutor.ts` and
 * `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`.
 */
export async function loadAgentWorkspaceContextOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceContextInput,
): Promise<AgentWorkspaceContextPayload> {
  const workspace = await loadSelectedWorkspaceSummary(dependencies, input);
  const deckSummary = await dependencies.summarizeDeckState(input.workspaceId);
  const schedulerSettings = await dependencies.getWorkspaceSchedulerSettings(input.workspaceId);

  return {
    workspace,
    deckSummary,
    schedulerSettings,
  };
}

/**
 * Canonical backend implementation of the external `list_tags` tool.
 */
export async function listAgentTagsOperation(
  dependencies: AgentToolOperationDependencies,
  input: Readonly<{ workspaceId: string }>,
): Promise<AgentWorkspaceTagsPayload> {
  return dependencies.listWorkspaceTagsSummary(input.workspaceId);
}

/**
 * Canonical backend implementation of the external `list_cards` tool.
 */
export async function listAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedLimitInput,
): Promise<AgentLimitedCardsPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  const result = await dependencies.queryCardsPage(input.workspaceId, {
    searchText: null,
    cursor: input.cursor,
    limit: limitApplied,
    sorts: [],
  });

  return {
    cards: result.cards,
    nextCursor: result.nextCursor,
  };
}

/**
 * Canonical backend implementation of the external `get_cards` tool.
 */
export async function getAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedGetCardsInput,
): Promise<AgentGetCardsPayload> {
  const cards = await dependencies.getCards(input.workspaceId, input.cardIds);

  return {
    cards,
    returnedCount: cards.length,
  };
}

/**
 * Canonical backend implementation of the external `search_cards` tool.
 */
export async function searchAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedSearchInput,
): Promise<AgentLimitedCardsPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  const result = await dependencies.queryCardsPage(input.workspaceId, {
    searchText: input.query,
    cursor: input.cursor,
    limit: limitApplied,
    sorts: [],
  });

  return {
    cards: result.cards,
    nextCursor: result.nextCursor,
  };
}

/**
 * Canonical backend implementation of the external `list_due_cards` tool.
 */
export async function listAgentDueCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedLimitInput,
): Promise<AgentLimitedCardsPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  const result = await dependencies.listReviewQueuePage(input.workspaceId, {
    cursor: input.cursor,
    limit: limitApplied,
  });

  return {
    cards: result.cards,
    nextCursor: result.nextCursor,
  };
}

/**
 * Canonical backend implementation of the external `list_decks` tool.
 */
export async function listAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedLimitInput,
): Promise<AgentLimitedDecksPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  return dependencies.listDecksPage(input.workspaceId, {
    cursor: input.cursor,
    limit: limitApplied,
  });
}

/**
 * Canonical backend implementation of the external `get_decks` tool.
 */
export async function getAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedGetDecksInput,
): Promise<AgentGetDecksPayload> {
  const decks = await dependencies.getDecks(input.workspaceId, input.deckIds);

  return {
    decks,
    returnedCount: decks.length,
  };
}

/**
 * Canonical backend implementation of the external `search_decks` tool.
 */
export async function searchAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedSearchInput,
): Promise<AgentLimitedDecksPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  return dependencies.searchDecksPage(input.workspaceId, input.query, {
    cursor: input.cursor,
    limit: limitApplied,
  });
}

/**
 * Canonical backend implementation of the external `list_review_history`
 * tool. Local mirrors keep their own data access but should preserve payload
 * shape and limit semantics.
 */
export async function listAgentReviewHistoryOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedReviewHistoryInput,
): Promise<AgentReviewHistoryPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  return dependencies.listReviewHistoryPage(input.workspaceId, {
    cursor: input.cursor,
    limit: limitApplied,
    cardId: input.cardId,
  });
}

/**
 * Canonical backend implementation of the external `get_scheduler_settings`
 * tool.
 */
export async function getAgentSchedulerSettingsOperation(
  dependencies: AgentToolOperationDependencies,
  input: Readonly<{ workspaceId: string }>,
): Promise<Readonly<{ schedulerSettings: WorkspaceSchedulerSettings }>> {
  return {
    schedulerSettings: await dependencies.getWorkspaceSchedulerSettings(input.workspaceId),
  };
}

/**
 * Canonical backend implementation of the external `create_cards` tool.
 */
export async function createAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: CreateCardsOperationInput,
): Promise<AgentCreateCardsPayload> {
  const metadata = await buildAgentMutationMetadata(dependencies, input, input.cards.length);
  const items: ReadonlyArray<BulkCreateCardItem> = input.cards.map((card, index) => ({
    input: toCreateCardInput(card),
    metadata: metadata[index],
  }));
  const cards = await dependencies.createCards(input.workspaceId, items);

  return {
    cards,
    createdCount: cards.length,
  };
}

/**
 * Canonical backend implementation of the external `update_cards` tool.
 */
export async function updateAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: UpdateCardsOperationInput,
): Promise<AgentUpdateCardsPayload> {
  const metadata = await buildAgentMutationMetadata(dependencies, input, input.updates.length);
  const items: ReadonlyArray<BulkUpdateCardItem> = input.updates.map((update, index) => ({
    cardId: update.cardId,
    input: toUpdateCardInput(update),
    metadata: metadata[index],
  }));
  const cards = await dependencies.updateCards(input.workspaceId, items);

  return {
    cards,
    updatedCount: cards.length,
  };
}

/**
 * Canonical backend implementation of the external `delete_cards` tool.
 */
export async function deleteAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: DeleteCardsOperationInput,
): Promise<Awaited<ReturnType<typeof deleteCards>>> {
  const metadata = await buildAgentMutationMetadata(dependencies, input, input.cardIds.length);
  const items: ReadonlyArray<BulkDeleteCardItem> = input.cardIds.map((cardId, index) => ({
    cardId,
    metadata: metadata[index],
  }));

  return dependencies.deleteCards(input.workspaceId, items);
}

/**
 * Canonical backend implementation of the external `create_decks` tool.
 */
export async function createAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: CreateDecksOperationInput,
): Promise<AgentCreateDecksPayload> {
  const metadata = await buildAgentMutationMetadata(dependencies, input, input.decks.length);
  const items: ReadonlyArray<BulkCreateDeckItem> = input.decks.map((deck, index) => ({
    input: toCreateDeckInput(deck),
    metadata: metadata[index],
  }));
  const decks = await dependencies.createDecks(input.workspaceId, items);

  return {
    decks,
    createdCount: decks.length,
  };
}

/**
 * Canonical backend implementation of the external `update_decks` tool.
 */
export async function updateAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: UpdateDecksOperationInput,
): Promise<AgentUpdateDecksPayload> {
  const currentDecks = await dependencies.getDecks(
    input.workspaceId,
    input.updates.map((update) => update.deckId),
  );
  const currentDeckById = new Map(currentDecks.map((deck) => [deck.deckId, deck] as const));
  const metadata = await buildAgentMutationMetadata(dependencies, input, input.updates.length);
  const items: ReadonlyArray<BulkUpdateDeckItem> = input.updates.map((update, index) => {
    const currentDeck = currentDeckById.get(update.deckId);
    if (currentDeck === undefined) {
      throw new HttpError(404, `Deck not found: ${update.deckId}`);
    }

    return {
      deckId: update.deckId,
      input: toUpdateDeckInput(update, currentDeck),
      metadata: metadata[index],
    };
  });
  const decks = await dependencies.updateDecks(input.workspaceId, items);

  return {
    decks,
    updatedCount: decks.length,
  };
}

/**
 * Canonical backend implementation of the external `delete_decks` tool.
 */
export async function deleteAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: DeleteDecksOperationInput,
): Promise<Awaited<ReturnType<typeof deleteDecks>>> {
  const metadata = await buildAgentMutationMetadata(dependencies, input, input.deckIds.length);
  const items: ReadonlyArray<BulkDeleteDeckItem> = input.deckIds.map((deckId, index) => ({
    deckId,
    metadata: metadata[index],
  }));

  return dependencies.deleteDecks(input.workspaceId, items);
}
