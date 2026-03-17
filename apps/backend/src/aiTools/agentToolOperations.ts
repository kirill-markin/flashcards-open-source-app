/**
 * Canonical backend operation layer for external AI-agent tools.
 *
 * This module owns the backend business behavior that used to live inline in
 * `apps/backend/src/routes/agent.ts`. That route file should stay transport
 * focused: auth, request parsing, workspace selection, envelope shaping, and
 * next-action hints. The backend tool behavior itself lives here.
 *
 * The web and iOS AI chat runtimes consume the results of this backend
 * behavior through the shared SQL tool contract instead of reimplementing it
 * against device-local state.
 *
 */
import { randomUUID } from "node:crypto";
import {
  createCards,
  deleteCards,
  getCards,
  listReviewHistoryPage,
  queryCardsPage,
  updateCards,
  type BulkCreateCardItem,
  type BulkDeleteCardItem,
  type BulkUpdateCardItem,
  type CardFilter,
  type CreateCardInput,
  type EffortLevel,
  type UpdateCardInput,
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
import { ensureAgentSyncDevice } from "../agentSyncIdentity";
import {
  getWorkspaceSchedulerSettings,
  type WorkspaceSchedulerSettings,
} from "../workspaceSchedulerSettings";
import {
  listUserWorkspacesForSelectedWorkspace,
  type WorkspaceSummary,
} from "../workspaces";

type SharedAiToolName =
  | "create_cards"
  | "update_cards"
  | "delete_cards"
  | "create_decks"
  | "update_decks"
  | "delete_decks";

type AgentToolCreateCardBody = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

type AgentToolUpdateCardBody = Readonly<{
  cardId: string;
  frontText: string | null;
  backText: string | null;
  tags: ReadonlyArray<string> | null;
  effortLevel: EffortLevel | null;
}>;

type AgentToolCreateCardsInput = Readonly<{
  cards: ReadonlyArray<AgentToolCreateCardBody>;
}>;

type AgentToolUpdateCardsInput = Readonly<{
  updates: ReadonlyArray<AgentToolUpdateCardBody>;
}>;

type AgentToolDeleteCardsInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

type AgentToolCreateDeckBody = Readonly<{
  name: string;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

type AgentToolUpdateDeckBody = Readonly<{
  deckId: string;
  name: string | null;
  effortLevels: ReadonlyArray<EffortLevel> | null;
  tags: ReadonlyArray<string> | null;
}>;

type AgentToolCreateDecksInput = Readonly<{
  decks: ReadonlyArray<AgentToolCreateDeckBody>;
}>;

type AgentToolUpdateDecksInput = Readonly<{
  updates: ReadonlyArray<AgentToolUpdateDeckBody>;
}>;

type AgentToolDeleteDecksInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

const EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT = 100;

export type AgentToolOperationDependencies = Readonly<{
  createCards: typeof createCards;
  deleteCards: typeof deleteCards;
  getCards: typeof getCards;
  listReviewHistoryPage: typeof listReviewHistoryPage;
  queryCardsPage: typeof queryCardsPage;
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
  userId: string;
  workspaceId: string;
  cursor: string | null;
  limit: number;
}>;

type WorkspaceScopedCardLimitInput = Readonly<{
  userId: string;
  workspaceId: string;
  cursor: string | null;
  limit: number;
  filter: CardFilter | null;
}>;

type WorkspaceScopedSearchInput = Readonly<{
  userId: string;
  workspaceId: string;
  query: string;
  cursor: string | null;
  limit: number;
}>;

type WorkspaceScopedCardSearchInput = Readonly<{
  userId: string;
  workspaceId: string;
  query: string;
  cursor: string | null;
  limit: number;
  filter: CardFilter | null;
}>;

type WorkspaceContextInput = Readonly<{
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
}>;

type WorkspaceScopedGetCardsInput = Readonly<{
  userId: string;
  workspaceId: string;
  cardIds: ReadonlyArray<string>;
}>;

type WorkspaceScopedGetDecksInput = Readonly<{
  userId: string;
  workspaceId: string;
  deckIds: ReadonlyArray<string>;
}>;

type WorkspaceScopedReviewHistoryInput = Readonly<{
  userId: string;
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

type AgentWorkspacePayload = Readonly<{
  workspace: WorkspaceSummary;
  schedulerSettings: WorkspaceSchedulerSettings;
}>;

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
  queryCardsPage,
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
 * Canonical backend implementation of the shared SQL `workspace` resource.
 * AI chat clients consume this through the backend SQL tool contract.
 */
export async function loadAgentWorkspaceOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceContextInput,
) : Promise<AgentWorkspacePayload> {
  const workspace = await loadSelectedWorkspaceSummary(dependencies, input);
  const schedulerSettings = await dependencies.getWorkspaceSchedulerSettings(input.userId, input.workspaceId);

  return {
    workspace,
    schedulerSettings,
  };
}

/**
 * Shared backend card-list implementation reused by the SQL surface.
 */
export async function listAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedCardLimitInput,
): Promise<AgentLimitedCardsPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  const result = await dependencies.queryCardsPage(input.userId, input.workspaceId, {
    searchText: null,
    cursor: input.cursor,
    limit: limitApplied,
    sorts: [],
    filter: input.filter,
  });

  return {
    cards: result.cards,
    nextCursor: result.nextCursor,
  };
}

/**
 * Shared backend card-by-id loader reused by the SQL surface.
 */
export async function getAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedGetCardsInput,
): Promise<AgentGetCardsPayload> {
  const cards = await dependencies.getCards(input.userId, input.workspaceId, input.cardIds);

  return {
    cards,
    returnedCount: cards.length,
  };
}

/**
 * Shared backend card-search implementation reused by the SQL surface.
 */
export async function searchAgentCardsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedCardSearchInput,
): Promise<AgentLimitedCardsPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  const result = await dependencies.queryCardsPage(input.userId, input.workspaceId, {
    searchText: input.query,
    cursor: input.cursor,
    limit: limitApplied,
    sorts: [],
    filter: input.filter,
  });

  return {
    cards: result.cards,
    nextCursor: result.nextCursor,
  };
}

/**
/**
 * Shared backend deck-list implementation reused by the SQL surface.
 */
export async function listAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedLimitInput,
): Promise<AgentLimitedDecksPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  return dependencies.listDecksPage(input.userId, input.workspaceId, {
    cursor: input.cursor,
    limit: limitApplied,
  });
}

/**
 * Shared backend deck-by-id loader reused by the SQL surface.
 */
export async function getAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedGetDecksInput,
): Promise<AgentGetDecksPayload> {
  const decks = await dependencies.getDecks(input.userId, input.workspaceId, input.deckIds);

  return {
    decks,
    returnedCount: decks.length,
  };
}

/**
 * Shared backend deck-search implementation reused by the SQL surface.
 */
export async function searchAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedSearchInput,
): Promise<AgentLimitedDecksPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  return dependencies.searchDecksPage(input.userId, input.workspaceId, input.query, {
    cursor: input.cursor,
    limit: limitApplied,
  });
}

/**
 * Shared backend review-event implementation reused by the SQL surface.
 * Local mirrors keep their own data access but should preserve payload shape
 * and limit semantics.
 */
export async function listAgentReviewEventsOperation(
  dependencies: AgentToolOperationDependencies,
  input: WorkspaceScopedReviewHistoryInput,
): Promise<AgentReviewHistoryPayload> {
  const limitApplied = normalizeAgentToolLimit(input.limit);
  return dependencies.listReviewHistoryPage(input.userId, input.workspaceId, {
    cursor: input.cursor,
    limit: limitApplied,
    cardId: input.cardId,
  });
}

/**
 * Shared backend card-creation implementation reused by the SQL surface.
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
  const cards = await dependencies.createCards(input.userId, input.workspaceId, items);

  return {
    cards,
    createdCount: cards.length,
  };
}

/**
 * Shared backend card-update implementation reused by the SQL surface.
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
  const cards = await dependencies.updateCards(input.userId, input.workspaceId, items);

  return {
    cards,
    updatedCount: cards.length,
  };
}

/**
 * Shared backend card-delete implementation reused by the SQL surface.
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

  return dependencies.deleteCards(input.userId, input.workspaceId, items);
}

/**
 * Shared backend deck-creation implementation reused by the SQL surface.
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
  const decks = await dependencies.createDecks(input.userId, input.workspaceId, items);

  return {
    decks,
    createdCount: decks.length,
  };
}

/**
 * Shared backend deck-update implementation reused by the SQL surface.
 */
export async function updateAgentDecksOperation(
  dependencies: AgentToolOperationDependencies,
  input: UpdateDecksOperationInput,
): Promise<AgentUpdateDecksPayload> {
  const currentDecks = await dependencies.getDecks(
    input.userId,
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
  const decks = await dependencies.updateDecks(input.userId, input.workspaceId, items);

  return {
    decks,
    updatedCount: decks.length,
  };
}

/**
 * Shared backend deck-delete implementation reused by the SQL surface.
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

  return dependencies.deleteDecks(input.userId, input.workspaceId, items);
}
