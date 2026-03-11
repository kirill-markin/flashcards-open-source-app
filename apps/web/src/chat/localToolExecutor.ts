import type { AppDataContextValue, MutableSnapshot } from "../appData/types";
import {
  deriveActiveCards,
  deriveActiveDecks,
  isCardDue,
  isCardNew,
  isCardReviewed,
  makeDeckCardStats,
} from "../appData/domain";
import type { PersistedOutboxRecord } from "../syncStorage";
import type {
  Card,
  CloudSettings,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  HomeSnapshot,
  SessionInfo,
  UpdateCardInput,
  UpdateDeckInput,
  UserSettings,
  Workspace,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../types";

type Nullable<T> = T | null;

type LocalToolExecutionResult = Readonly<{
  output: string;
  didMutateAppState: boolean;
}>;

export type LocalToolCallRequest = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export const LOCAL_TOOL_NAMES = [
  "get_workspace_context",
  "list_cards",
  "get_cards",
  "search_cards",
  "list_due_cards",
  "list_decks",
  "search_decks",
  "get_decks",
  "list_review_history",
  "get_scheduler_settings",
  "get_cloud_settings",
  "list_outbox",
  "summarize_deck_state",
  "create_cards",
  "update_cards",
  "delete_cards",
  "create_decks",
  "update_decks",
  "delete_decks",
] as const;

type AIWorkspaceContextPayload = Readonly<{
  workspace: Workspace;
  userSettings: UserSettings;
  schedulerSettings: WorkspaceSchedulerSettings;
  cloudSettings: CloudSettings;
  homeSnapshot: HomeSnapshot;
}>;

type AIOutboxEntryPayload = Readonly<{
  operationId: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  action: string;
  clientUpdatedAt: string;
  createdAt: string;
  attemptCount: number;
  lastError: string;
  payloadSummary: string;
}>;

type AIBulkDeleteCardsPayload = Readonly<{
  ok: true;
  deletedCardIds: ReadonlyArray<string>;
  deletedCount: number;
}>;

type AIBulkDeleteDecksPayload = Readonly<{
  ok: true;
  deletedDeckIds: ReadonlyArray<string>;
  deletedCount: number;
}>;

type DeckSummaryPayload = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
  totalReps: number;
  totalLapses: number;
}>;

type CreateCardToolInput = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: Card["effortLevel"];
}>;

type CreateCardsToolInput = Readonly<{
  cards: ReadonlyArray<CreateCardToolInput>;
}>;

type GetCardsToolInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

type UpdateCardToolInput = Readonly<{
  cardId: string;
  frontText: Nullable<string>;
  backText: Nullable<string>;
  tags: Nullable<ReadonlyArray<string>>;
  effortLevel: Nullable<Card["effortLevel"]>;
}>;

type UpdateCardsToolInput = Readonly<{
  updates: ReadonlyArray<UpdateCardToolInput>;
}>;

type DeleteCardsToolInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

type CreateDeckToolInput = Readonly<{
  name: string;
  effortLevels: ReadonlyArray<Card["effortLevel"]>;
  tags: ReadonlyArray<string>;
}>;

type CreateDecksToolInput = Readonly<{
  decks: ReadonlyArray<CreateDeckToolInput>;
}>;

type UpdateDeckToolInput = Readonly<{
  deckId: string;
  name: Nullable<string>;
  effortLevels: Nullable<ReadonlyArray<Card["effortLevel"]>>;
  tags: Nullable<ReadonlyArray<string>>;
}>;

type UpdateDecksToolInput = Readonly<{
  updates: ReadonlyArray<UpdateDeckToolInput>;
}>;

type DeleteDecksToolInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

type SearchCardsToolInput = Readonly<{
  query: string;
  limit: number | null;
}>;

type SearchDecksToolInput = Readonly<{
  query: string;
  limit: number | null;
}>;

type ListCardsToolInput = Readonly<{
  limit: number | null;
}>;

type ListDueCardsToolInput = Readonly<{
  limit: number | null;
}>;

type GetDecksToolInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

type ListReviewHistoryToolInput = Readonly<{
  limit: number | null;
  cardId: string | null;
}>;

type ListOutboxToolInput = Readonly<{
  limit: number | null;
}>;

type WebLocalToolExecutorDependencies = Pick<
  AppDataContextValue,
  | "session"
  | "activeWorkspace"
  | "getLocalSnapshot"
  | "createCardItem"
  | "createDeckItem"
  | "updateCardItem"
  | "updateDeckItem"
  | "deleteCardItem"
  | "deleteDeckItem"
>;

const MAX_BATCH_COUNT = 100;

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}

function expectNoExtraKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlyArray<string>,
  context: string,
): void {
  for (const key of Object.keys(value)) {
    if (allowedKeys.includes(key) === false) {
      throw new Error(`${context}.${key} is not supported`);
    }
  }
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string`);
  }

  return value;
}

function expectNullableString(value: unknown, context: string): string | null {
  if (value === null) {
    return null;
  }

  return expectString(value, context);
}

function expectInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || Number.isInteger(value) === false) {
    throw new Error(`${context} must be an integer`);
  }

  return value;
}

function expectNullableInteger(value: unknown, context: string): number | null {
  if (value === null) {
    return null;
  }

  return expectInteger(value, context);
}

function expectEffortLevel(value: unknown, context: string): Card["effortLevel"] {
  if (value === "fast" || value === "medium" || value === "long") {
    return value;
  }

  throw new Error(`${context} must be one of: fast, medium, long`);
}

function expectStringArray(value: unknown, context: string): ReadonlyArray<string> {
  if (Array.isArray(value) === false) {
    throw new Error(`${context} must be an array`);
  }

  return value.map((item, index) => expectString(item, `${context}[${index}]`));
}

function expectNullableStringArray(value: unknown, context: string): ReadonlyArray<string> | null {
  if (value === null) {
    return null;
  }

  return expectStringArray(value, context);
}

function expectEffortLevelArray(value: unknown, context: string): ReadonlyArray<Card["effortLevel"]> {
  if (Array.isArray(value) === false) {
    throw new Error(`${context} must be an array`);
  }

  return value.map((item, index) => expectEffortLevel(item, `${context}[${index}]`));
}

function expectNullableEffortLevelArray(
  value: unknown,
  context: string,
): ReadonlyArray<Card["effortLevel"]> | null {
  if (value === null) {
    return null;
  }

  return expectEffortLevelArray(value, context);
}

function expectArray(value: unknown, context: string): ReadonlyArray<unknown> {
  if (Array.isArray(value) === false) {
    throw new Error(`${context} must be an array`);
  }

  return value;
}

function parseToolInput(toolCallRequest: LocalToolCallRequest): unknown {
  try {
    return JSON.parse(toolCallRequest.input) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool ${toolCallRequest.name} input is invalid JSON: ${message}`);
  }
}

function normalizeLimit(limit: number | null): number {
  if (limit === null) {
    return 20;
  }

  return Math.min(Math.max(limit, 1), 100);
}

function parseEmptyObjectInput(toolCallRequest: LocalToolCallRequest): void {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, [], toolCallRequest.name);
}

function parseListLimitInput(toolCallRequest: LocalToolCallRequest): Readonly<{ limit: number | null }> {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["limit"], toolCallRequest.name);
  return {
    limit: expectNullableInteger(body.limit, `${toolCallRequest.name}.limit`),
  };
}

function parseQueryLimitInput(
  toolCallRequest: LocalToolCallRequest,
): Readonly<{ query: string; limit: number | null }> {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["query", "limit"], toolCallRequest.name);
  return {
    query: expectString(body.query, `${toolCallRequest.name}.query`),
    limit: expectNullableInteger(body.limit, `${toolCallRequest.name}.limit`),
  };
}

function parseCardIdsInput(toolCallRequest: LocalToolCallRequest): GetCardsToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["cardIds"], toolCallRequest.name);
  return {
    cardIds: expectStringArray(body.cardIds, `${toolCallRequest.name}.cardIds`),
  };
}

function parseDeckIdsInput(toolCallRequest: LocalToolCallRequest): GetDecksToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["deckIds"], toolCallRequest.name);
  return {
    deckIds: expectStringArray(body.deckIds, `${toolCallRequest.name}.deckIds`),
  };
}

function parseListReviewHistoryInput(toolCallRequest: LocalToolCallRequest): ListReviewHistoryToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["limit", "cardId"], toolCallRequest.name);
  return {
    limit: expectNullableInteger(body.limit, `${toolCallRequest.name}.limit`),
    cardId: expectNullableString(body.cardId, `${toolCallRequest.name}.cardId`),
  };
}

function parseCreateCardsInput(toolCallRequest: LocalToolCallRequest): CreateCardsToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["cards"], toolCallRequest.name);

  return {
    cards: expectArray(body.cards, `${toolCallRequest.name}.cards`).map((item, index) => {
      const entry = expectRecord(item, `${toolCallRequest.name}.cards[${index}]`);
      expectNoExtraKeys(entry, ["frontText", "backText", "tags", "effortLevel"], `${toolCallRequest.name}.cards[${index}]`);
      return {
        frontText: expectString(entry.frontText, `${toolCallRequest.name}.cards[${index}].frontText`),
        backText: expectString(entry.backText, `${toolCallRequest.name}.cards[${index}].backText`),
        tags: expectStringArray(entry.tags, `${toolCallRequest.name}.cards[${index}].tags`),
        effortLevel: expectEffortLevel(entry.effortLevel, `${toolCallRequest.name}.cards[${index}].effortLevel`),
      };
    }),
  };
}

function parseUpdateCardsInput(toolCallRequest: LocalToolCallRequest): UpdateCardsToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["updates"], toolCallRequest.name);

  return {
    updates: expectArray(body.updates, `${toolCallRequest.name}.updates`).map((item, index) => {
      const entry = expectRecord(item, `${toolCallRequest.name}.updates[${index}]`);
      expectNoExtraKeys(
        entry,
        ["cardId", "frontText", "backText", "tags", "effortLevel"],
        `${toolCallRequest.name}.updates[${index}]`,
      );
      return {
        cardId: expectString(entry.cardId, `${toolCallRequest.name}.updates[${index}].cardId`),
        frontText: expectNullableString(entry.frontText, `${toolCallRequest.name}.updates[${index}].frontText`),
        backText: expectNullableString(entry.backText, `${toolCallRequest.name}.updates[${index}].backText`),
        tags: expectNullableStringArray(entry.tags, `${toolCallRequest.name}.updates[${index}].tags`),
        effortLevel: entry.effortLevel === null
          ? null
          : expectEffortLevel(entry.effortLevel, `${toolCallRequest.name}.updates[${index}].effortLevel`),
      };
    }),
  };
}

function parseDeleteCardsInput(toolCallRequest: LocalToolCallRequest): DeleteCardsToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["cardIds"], toolCallRequest.name);
  return {
    cardIds: expectStringArray(body.cardIds, `${toolCallRequest.name}.cardIds`),
  };
}

function parseCreateDecksInput(toolCallRequest: LocalToolCallRequest): CreateDecksToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["decks"], toolCallRequest.name);

  return {
    decks: expectArray(body.decks, `${toolCallRequest.name}.decks`).map((item, index) => {
      const entry = expectRecord(item, `${toolCallRequest.name}.decks[${index}]`);
      expectNoExtraKeys(entry, ["name", "effortLevels", "tags"], `${toolCallRequest.name}.decks[${index}]`);
      return {
        name: expectString(entry.name, `${toolCallRequest.name}.decks[${index}].name`),
        effortLevels: expectEffortLevelArray(entry.effortLevels, `${toolCallRequest.name}.decks[${index}].effortLevels`),
        tags: expectStringArray(entry.tags, `${toolCallRequest.name}.decks[${index}].tags`),
      };
    }),
  };
}

function parseUpdateDecksInput(toolCallRequest: LocalToolCallRequest): UpdateDecksToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["updates"], toolCallRequest.name);

  return {
    updates: expectArray(body.updates, `${toolCallRequest.name}.updates`).map((item, index) => {
      const entry = expectRecord(item, `${toolCallRequest.name}.updates[${index}]`);
      expectNoExtraKeys(entry, ["deckId", "name", "effortLevels", "tags"], `${toolCallRequest.name}.updates[${index}]`);
      return {
        deckId: expectString(entry.deckId, `${toolCallRequest.name}.updates[${index}].deckId`),
        name: expectNullableString(entry.name, `${toolCallRequest.name}.updates[${index}].name`),
        effortLevels: expectNullableEffortLevelArray(
          entry.effortLevels,
          `${toolCallRequest.name}.updates[${index}].effortLevels`,
        ),
        tags: expectNullableStringArray(entry.tags, `${toolCallRequest.name}.updates[${index}].tags`),
      };
    }),
  };
}

function parseDeleteDecksInput(toolCallRequest: LocalToolCallRequest): DeleteDecksToolInput {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["deckIds"], toolCallRequest.name);
  return {
    deckIds: expectStringArray(body.deckIds, `${toolCallRequest.name}.deckIds`),
  };
}

function validateBatchCount(count: number, label: string): void {
  if (count < 1) {
    throw new Error(`${label} batch must contain at least one item`);
  }

  if (count > MAX_BATCH_COUNT) {
    throw new Error(`${label} batch must contain at most ${MAX_BATCH_COUNT} items`);
  }
}

function validateUniqueIds(ids: ReadonlyArray<string>, label: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} batch must not contain duplicate ${label.toLowerCase()}Id values`);
  }
}

function compareCardsByUpdatedAt(left: Card, right: Card): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareDecksByUpdatedAt(left: Deck, right: Deck): number {
  const updatedAtDifference = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtDifference !== 0) {
    return updatedAtDifference;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function currentActiveCards(snapshot: MutableSnapshot): ReadonlyArray<Card> {
  return [...deriveActiveCards(snapshot.cards)].sort(compareCardsByUpdatedAt);
}

function activeDecks(snapshot: MutableSnapshot): ReadonlyArray<Deck> {
  return [...deriveActiveDecks(snapshot.decks)].sort(compareDecksByUpdatedAt);
}

function dueCards(snapshot: MutableSnapshot): ReadonlyArray<Card> {
  const nowTimestamp = Date.now();
  return currentActiveCards(snapshot)
    .filter((card) => isCardDue(card, nowTimestamp))
    .sort((left, right) => {
      const leftDueAt = left.dueAt ?? "";
      const rightDueAt = right.dueAt ?? "";
      if (leftDueAt !== rightDueAt) {
        return leftDueAt.localeCompare(rightDueAt);
      }

      return compareCardsByUpdatedAt(left, right);
    });
}

function findCard(snapshot: MutableSnapshot, cardId: string): Card {
  const card = snapshot.cards.find((item) => item.cardId === cardId && item.deletedAt === null);
  if (card === undefined) {
    throw new Error("Card not found");
  }

  return card;
}

function findDeck(snapshot: MutableSnapshot, deckId: string): Deck {
  const deck = snapshot.decks.find((item) => item.deckId === deckId && item.deletedAt === null);
  if (deck === undefined) {
    throw new Error("Deck not found");
  }

  return deck;
}

function searchCards(snapshot: MutableSnapshot, query: string, limit: number): ReadonlyArray<Card> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === "") {
    throw new Error("query must not be empty");
  }

  return currentActiveCards(snapshot)
    .filter((card) => card.frontText.toLowerCase().includes(normalizedQuery)
      || card.backText.toLowerCase().includes(normalizedQuery)
      || card.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      || card.effortLevel.toLowerCase().includes(normalizedQuery))
    .slice(0, limit);
}

function searchDecks(snapshot: MutableSnapshot, query: string, limit: number): ReadonlyArray<Deck> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === "") {
    throw new Error("query must not be empty");
  }

  return activeDecks(snapshot)
    .filter((deck) => deck.name.toLowerCase().includes(normalizedQuery)
      || deck.filterDefinition.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      || deck.filterDefinition.effortLevels.some((effortLevel) => effortLevel.toLowerCase().includes(normalizedQuery)))
    .slice(0, limit);
}

function describeOutboxPayload(record: PersistedOutboxRecord): string {
  if (record.operation.entityType === "card") {
    return `card ${record.operation.payload.cardId}`;
  }

  if (record.operation.entityType === "deck") {
    return `deck ${record.operation.payload.deckId}`;
  }

  if (record.operation.entityType === "workspace_scheduler_settings") {
    return "workspace scheduler settings";
  }

  return `review event ${record.operation.payload.reviewEventId}`;
}

function makeWorkspace(activeWorkspace: WorkspaceSummary): Workspace {
  return {
    workspaceId: activeWorkspace.workspaceId,
    name: activeWorkspace.name,
    createdAt: activeWorkspace.createdAt,
  };
}

function makeUserSettings(session: SessionInfo, activeWorkspace: WorkspaceSummary): UserSettings {
  return {
    userId: session.userId,
    workspaceId: activeWorkspace.workspaceId,
    email: session.profile.email,
    locale: session.profile.locale,
    createdAt: session.profile.createdAt,
  };
}

function makeHomeSnapshot(snapshot: MutableSnapshot): HomeSnapshot {
  const activeCards = deriveActiveCards(snapshot.cards);

  return {
    deckCount: activeDecks(snapshot).length,
    totalCards: activeCards.length,
    dueCount: activeCards.filter((card) => isCardDue(card, Date.now())).length,
    newCount: activeCards.filter((card) => isCardNew(card)).length,
    reviewedCount: activeCards.filter((card) => isCardReviewed(card)).length,
  };
}

function makeWorkspaceContextPayload(
  session: SessionInfo,
  activeWorkspace: WorkspaceSummary,
  snapshot: MutableSnapshot,
): AIWorkspaceContextPayload {
  const schedulerSettings = snapshot.workspaceSettings;
  if (schedulerSettings === null) {
    throw new Error("Workspace scheduler settings are not loaded");
  }

  const cloudSettings = snapshot.cloudSettings;
  if (cloudSettings === null) {
    throw new Error("Cloud settings are not loaded");
  }

  return {
    workspace: makeWorkspace(activeWorkspace),
    userSettings: makeUserSettings(session, activeWorkspace),
    schedulerSettings,
    cloudSettings,
    homeSnapshot: makeHomeSnapshot(snapshot),
  };
}

function makeOutboxPayload(
  snapshot: MutableSnapshot,
  workspaceId: string,
  limit: number,
): ReadonlyArray<AIOutboxEntryPayload> {
  return snapshot.outbox
    .filter((entry) => entry.workspaceId === workspaceId)
    .slice(0, limit)
    .map((entry) => ({
      operationId: entry.operationId,
      workspaceId: entry.workspaceId,
      entityType: entry.operation.entityType,
      entityId: entry.operation.entityId,
      action: entry.operation.action,
      clientUpdatedAt: entry.operation.clientUpdatedAt,
      createdAt: entry.createdAt,
      attemptCount: entry.attemptCount,
      lastError: entry.lastError,
      payloadSummary: describeOutboxPayload(entry),
    }));
}

function makeDeckSummary(snapshot: MutableSnapshot): DeckSummaryPayload {
  const activeCards = deriveActiveCards(snapshot.cards);
  const aggregateStats = makeDeckCardStats(activeCards, Date.now());

  return {
    totalCards: aggregateStats.totalCards,
    dueCards: aggregateStats.dueCards,
    newCards: aggregateStats.newCards,
    reviewedCards: aggregateStats.reviewedCards,
    totalReps: activeCards.reduce((sum, card) => sum + card.reps, 0),
    totalLapses: activeCards.reduce((sum, card) => sum + card.lapses, 0),
  };
}

function toCreateCardInput(input: CreateCardToolInput): CreateCardInput {
  return {
    frontText: input.frontText,
    backText: input.backText,
    tags: input.tags,
    effortLevel: input.effortLevel,
  };
}

function toCreateDeckInput(input: CreateDeckToolInput): CreateDeckInput {
  return {
    name: input.name,
    filterDefinition: {
      version: 2,
      effortLevels: input.effortLevels,
      tags: input.tags,
    },
  };
}

function toResolvedCardUpdateInput(existingCard: Card, input: UpdateCardToolInput): UpdateCardInput {
  return {
    frontText: input.frontText ?? existingCard.frontText,
    backText: input.backText ?? existingCard.backText,
    tags: input.tags ?? existingCard.tags,
    effortLevel: input.effortLevel ?? existingCard.effortLevel,
  };
}

function toResolvedDeckUpdateInput(existingDeck: Deck, input: UpdateDeckToolInput): UpdateDeckInput {
  return {
    name: input.name ?? existingDeck.name,
    filterDefinition: {
      version: 2,
      effortLevels: input.effortLevels ?? existingDeck.filterDefinition.effortLevels,
      tags: input.tags ?? existingDeck.filterDefinition.tags,
    },
  };
}

function ensureLocalWorkspace(
  dependencies: WebLocalToolExecutorDependencies,
): Readonly<{
  session: SessionInfo;
  activeWorkspace: WorkspaceSummary;
  snapshot: MutableSnapshot;
}> {
  if (dependencies.session === null) {
    throw new Error("Session is unavailable");
  }

  if (dependencies.activeWorkspace === null) {
    throw new Error("Workspace is unavailable");
  }

  return {
    session: dependencies.session,
    activeWorkspace: dependencies.activeWorkspace,
    snapshot: dependencies.getLocalSnapshot(),
  };
}

/**
 * Builds a browser-local AI tool executor that mirrors the iOS local tool
 * contract while using the web app sync snapshot and IndexedDB-backed writes.
 */
export function createLocalToolExecutor(
  dependencies: WebLocalToolExecutorDependencies,
): Readonly<{
  execute: (toolCallRequest: LocalToolCallRequest) => Promise<LocalToolExecutionResult>;
}> {
  return {
    async execute(toolCallRequest: LocalToolCallRequest): Promise<LocalToolExecutionResult> {
      const { session, activeWorkspace, snapshot } = ensureLocalWorkspace(dependencies);

      switch (toolCallRequest.name) {
      case "get_workspace_context":
        parseEmptyObjectInput(toolCallRequest);
        return {
          output: JSON.stringify(makeWorkspaceContextPayload(session, activeWorkspace, snapshot)),
          didMutateAppState: false,
        };
      case "list_cards": {
        const input = parseListLimitInput(toolCallRequest);
        return {
          output: JSON.stringify(currentActiveCards(snapshot).slice(0, normalizeLimit(input.limit))),
          didMutateAppState: false,
        };
      }
      case "get_cards": {
        const input = parseCardIdsInput(toolCallRequest);
        validateBatchCount(input.cardIds.length, "Card");
        validateUniqueIds(input.cardIds, "Card");
        return {
          output: JSON.stringify(input.cardIds.map((cardId) => findCard(snapshot, cardId))),
          didMutateAppState: false,
        };
      }
      case "search_cards": {
        const input = parseQueryLimitInput(toolCallRequest);
        return {
          output: JSON.stringify(searchCards(snapshot, input.query, normalizeLimit(input.limit))),
          didMutateAppState: false,
        };
      }
      case "list_due_cards": {
        const input = parseListLimitInput(toolCallRequest);
        return {
          output: JSON.stringify(dueCards(snapshot).slice(0, normalizeLimit(input.limit))),
          didMutateAppState: false,
        };
      }
      case "list_decks":
        parseEmptyObjectInput(toolCallRequest);
        return {
          output: JSON.stringify(activeDecks(snapshot)),
          didMutateAppState: false,
        };
      case "search_decks": {
        const input = parseQueryLimitInput(toolCallRequest);
        return {
          output: JSON.stringify(searchDecks(snapshot, input.query, normalizeLimit(input.limit))),
          didMutateAppState: false,
        };
      }
      case "get_decks": {
        const input = parseDeckIdsInput(toolCallRequest);
        validateBatchCount(input.deckIds.length, "Deck");
        validateUniqueIds(input.deckIds, "Deck");
        return {
          output: JSON.stringify(input.deckIds.map((deckId) => findDeck(snapshot, deckId))),
          didMutateAppState: false,
        };
      }
      case "list_review_history": {
        const input = parseListReviewHistoryInput(toolCallRequest);
        const reviewEvents = input.cardId === null
          ? snapshot.reviewEvents
          : snapshot.reviewEvents.filter((event) => event.cardId === input.cardId);
        return {
          output: JSON.stringify(reviewEvents.slice(0, normalizeLimit(input.limit))),
          didMutateAppState: false,
        };
      }
      case "get_scheduler_settings":
        parseEmptyObjectInput(toolCallRequest);
        if (snapshot.workspaceSettings === null) {
          throw new Error("Workspace scheduler settings are not loaded");
        }

        return {
          output: JSON.stringify(snapshot.workspaceSettings),
          didMutateAppState: false,
        };
      case "get_cloud_settings":
        parseEmptyObjectInput(toolCallRequest);
        if (snapshot.cloudSettings === null) {
          throw new Error("Cloud settings are not loaded");
        }

        return {
          output: JSON.stringify(snapshot.cloudSettings),
          didMutateAppState: false,
        };
      case "list_outbox": {
        const input = parseListLimitInput(toolCallRequest);
        return {
          output: JSON.stringify(
            makeOutboxPayload(snapshot, activeWorkspace.workspaceId, normalizeLimit(input.limit)),
          ),
          didMutateAppState: false,
        };
      }
      case "summarize_deck_state":
        parseEmptyObjectInput(toolCallRequest);
        return {
          output: JSON.stringify(makeDeckSummary(snapshot)),
          didMutateAppState: false,
        };
      case "create_cards": {
        const input = parseCreateCardsInput(toolCallRequest);
        validateBatchCount(input.cards.length, "Card");
        const createdCards = await Promise.all(input.cards.map((card) => dependencies.createCardItem(toCreateCardInput(card))));
        return {
          output: JSON.stringify(createdCards),
          didMutateAppState: true,
        };
      }
      case "update_cards": {
        const input = parseUpdateCardsInput(toolCallRequest);
        validateBatchCount(input.updates.length, "Card");
        validateUniqueIds(input.updates.map((item) => item.cardId), "Card");
        const updatedCards = await Promise.all(input.updates.map((update) => dependencies.updateCardItem(
          update.cardId,
          toResolvedCardUpdateInput(findCard(snapshot, update.cardId), update),
        )));
        return {
          output: JSON.stringify(updatedCards),
          didMutateAppState: true,
        };
      }
      case "delete_cards": {
        const input = parseDeleteCardsInput(toolCallRequest);
        validateBatchCount(input.cardIds.length, "Card");
        validateUniqueIds(input.cardIds, "Card");
        await Promise.all(input.cardIds.map((cardId) => dependencies.deleteCardItem(cardId)));
        return {
          output: JSON.stringify({
            ok: true,
            deletedCardIds: input.cardIds,
            deletedCount: input.cardIds.length,
          } satisfies AIBulkDeleteCardsPayload),
          didMutateAppState: true,
        };
      }
      case "create_decks": {
        const input = parseCreateDecksInput(toolCallRequest);
        validateBatchCount(input.decks.length, "Deck");
        const createdDecks = await Promise.all(input.decks.map((deck) => dependencies.createDeckItem(toCreateDeckInput(deck))));
        return {
          output: JSON.stringify(createdDecks),
          didMutateAppState: true,
        };
      }
      case "update_decks": {
        const input = parseUpdateDecksInput(toolCallRequest);
        validateBatchCount(input.updates.length, "Deck");
        validateUniqueIds(input.updates.map((item) => item.deckId), "Deck");
        const updatedDecks = await Promise.all(input.updates.map((update) => dependencies.updateDeckItem(
          update.deckId,
          toResolvedDeckUpdateInput(findDeck(snapshot, update.deckId), update),
        )));
        return {
          output: JSON.stringify(updatedDecks),
          didMutateAppState: true,
        };
      }
      case "delete_decks": {
        const input = parseDeleteDecksInput(toolCallRequest);
        validateBatchCount(input.deckIds.length, "Deck");
        validateUniqueIds(input.deckIds, "Deck");
        await Promise.all(input.deckIds.map((deckId) => dependencies.deleteDeckItem(deckId)));
        return {
          output: JSON.stringify({
            ok: true,
            deletedDeckIds: input.deckIds,
            deletedCount: input.deckIds.length,
          } satisfies AIBulkDeleteDecksPayload),
          didMutateAppState: true,
        };
      }
      default:
        throw new Error(`Unsupported AI tool: ${toolCallRequest.name}`);
      }
    },
  };
}
