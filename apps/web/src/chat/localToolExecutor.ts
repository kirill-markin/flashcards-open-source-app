/**
 * Browser-local AI tool executor.
 *
 * Shared workspace access is intentionally collapsed to the single `sql` tool
 * so the browser-local runtime mirrors the public agent surface. Local-only
 * runtime utilities remain separate.
 *
 * The iOS mirror lives in
 * `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`.
 */
import type { AppDataContextValue, MutableSnapshot } from "../appData/types";
import {
  deriveActiveCards,
  deriveActiveDecks,
} from "../appData/domain";
import type { PersistedOutboxRecord } from "../syncStorage";
import type {
  Card,
  CloudSettings,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSummary,
} from "../types";
import {
  executeSqlSelect,
  getSqlResourceDescriptor,
  getSqlResourceDescriptors,
  likePatternToRegExp,
  parseSqlStatement,
  type SqlRow,
  type SqlResourceName,
} from "../../../backend/src/aiTools/sqlDialect";

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

/**
 * Browser-local tool catalog. Keep this aligned with the mirrored iOS local
 * tool list in `apps/ios/Flashcards/Flashcards/AI/AIChatTypes.swift`.
 */
export const LOCAL_TOOL_NAMES = [
  "sql",
  "get_cloud_settings",
  "list_outbox",
] as const;

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

type LocalOutboxPagePayload = Readonly<{
  outbox: ReadonlyArray<AIOutboxEntryPayload>;
  nextCursor: string | null;
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

type SqlExecutionPayload =
  | Readonly<{
    statementType: "show_tables" | "describe" | "select";
    resource: SqlResourceName | null;
    sql: string;
    normalizedSql: string;
    rows: ReadonlyArray<SqlRow>;
    rowCount: number;
    limit: number | null;
    offset: number | null;
    hasMore: boolean;
  }>
  | Readonly<{
    statementType: "insert" | "update" | "delete";
    resource: "cards" | "decks";
    sql: string;
    normalizedSql: string;
    rows: ReadonlyArray<SqlRow>;
    affectedCount: number;
  }>;

const MAX_SQL_LIMIT = 100;

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

function normalizeLimit(limit: number): number {
  if (limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }

  return limit;
}

function parseToolInput(toolCallRequest: LocalToolCallRequest): unknown {
  try {
    return JSON.parse(toolCallRequest.input) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool ${toolCallRequest.name} input is invalid JSON: ${message}`);
  }
}

function parseEmptyObjectInput(toolCallRequest: LocalToolCallRequest): void {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, [], toolCallRequest.name);
}

function parseSqlInput(toolCallRequest: LocalToolCallRequest): Readonly<{ sql: string }> {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["sql"], toolCallRequest.name);
  return {
    sql: expectString(body.sql, `${toolCallRequest.name}.sql`).trim(),
  };
}

function parseListOutboxInput(toolCallRequest: LocalToolCallRequest): Readonly<{ cursor: string | null; limit: number }> {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["cursor", "limit"], toolCallRequest.name);
  return {
    cursor: expectNullableString(body.cursor, `${toolCallRequest.name}.cursor`),
    limit: expectInteger(body.limit, `${toolCallRequest.name}.limit`),
  };
}

function encodePageCursor(index: number): string {
  const jsonValue = JSON.stringify({ index });
  return globalThis.btoa(jsonValue)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodePageCursor(cursor: string): number {
  try {
    const normalizedCursor = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const paddingLength = (4 - (normalizedCursor.length % 4)) % 4;
    const paddedCursor = `${normalizedCursor}${"=".repeat(paddingLength)}`;
    const parsedValue = JSON.parse(globalThis.atob(paddedCursor)) as unknown;
    const recordValue = expectRecord(parsedValue, "cursor");
    const index = recordValue.index;
    if (typeof index !== "number" || Number.isInteger(index) === false || index < 0) {
      throw new Error("Cursor index must be a non-negative integer");
    }

    return index;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cursor is invalid: ${message}`);
  }
}

function getPageStartIndex(cursor: string | null): number {
  if (cursor === null) {
    return 0;
  }

  return decodePageCursor(cursor);
}

function getNextCursorForPage(totalCount: number, startIndex: number, visibleCount: number): string | null {
  const nextIndex = startIndex + visibleCount;
  if (nextIndex >= totalCount) {
    return null;
  }

  return encodePageCursor(nextIndex);
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

function findCard(snapshot: MutableSnapshot, cardId: string): Card {
  const card = snapshot.cards.find((item) => item.cardId === cardId && item.deletedAt === null);
  if (card === undefined) {
    throw new Error(`Card not found: ${cardId}`);
  }

  return card;
}

function findDeck(snapshot: MutableSnapshot, deckId: string): Deck {
  const deck = snapshot.decks.find((item) => item.deckId === deckId && item.deletedAt === null);
  if (deck === undefined) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  return deck;
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

function makeOutboxPayload(
  snapshot: MutableSnapshot,
  workspaceId: string,
  startIndex: number,
  limit: number,
): LocalOutboxPagePayload {
  const workspaceEntries = snapshot.outbox.filter((entry) => entry.workspaceId === workspaceId);
  const visibleEntries = workspaceEntries.slice(startIndex, startIndex + limit);
  return {
    outbox: visibleEntries.map((entry) => ({
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
    })),
    nextCursor: getNextCursorForPage(workspaceEntries.length, startIndex, visibleEntries.length),
  };
}

function toCardRow(card: Card): SqlRow {
  return {
    card_id: card.cardId,
    front_text: card.frontText,
    back_text: card.backText,
    tags: card.tags,
    effort_level: card.effortLevel,
    due_at: card.dueAt,
    reps: card.reps,
    lapses: card.lapses,
    updated_at: card.updatedAt,
    deleted_at: card.deletedAt,
    fsrs_card_state: card.fsrsCardState,
    fsrs_step_index: card.fsrsStepIndex,
    fsrs_stability: card.fsrsStability,
    fsrs_difficulty: card.fsrsDifficulty,
    fsrs_last_reviewed_at: card.fsrsLastReviewedAt,
    fsrs_scheduled_days: card.fsrsScheduledDays,
  };
}

function toDeckRow(deck: Deck): SqlRow {
  return {
    deck_id: deck.deckId,
    name: deck.name,
    tags: deck.filterDefinition.tags,
    effort_levels: deck.filterDefinition.effortLevels,
    created_at: deck.createdAt,
    updated_at: deck.updatedAt,
    deleted_at: deck.deletedAt,
  };
}

function loadSelectRows(
  activeWorkspace: WorkspaceSummary,
  snapshot: MutableSnapshot,
  resourceName: SqlResourceName,
): ReadonlyArray<SqlRow> {
  if (resourceName === "workspace") {
    if (snapshot.workspaceSettings === null) {
      throw new Error("Workspace scheduler settings are not loaded");
    }

    return [{
      workspace_id: activeWorkspace.workspaceId,
      name: activeWorkspace.name,
      created_at: activeWorkspace.createdAt,
      algorithm: snapshot.workspaceSettings.algorithm,
      desired_retention: snapshot.workspaceSettings.desiredRetention,
      learning_steps_minutes: snapshot.workspaceSettings.learningStepsMinutes,
      relearning_steps_minutes: snapshot.workspaceSettings.relearningStepsMinutes,
      maximum_interval_days: snapshot.workspaceSettings.maximumIntervalDays,
      enable_fuzz: snapshot.workspaceSettings.enableFuzz,
    }];
  }

  if (resourceName === "cards") {
    return currentActiveCards(snapshot).map(toCardRow);
  }

  if (resourceName === "decks") {
    return activeDecks(snapshot).map(toDeckRow);
  }

  return snapshot.reviewEvents.map((event) => ({
    review_event_id: event.reviewEventId,
    card_id: event.cardId,
    device_id: event.deviceId,
    client_event_id: event.clientEventId,
    rating: event.rating,
    reviewed_at_client: event.reviewedAtClient,
    reviewed_at_server: event.reviewedAtServer,
  }));
}

function toCreateCardInput(row: Readonly<Record<string, unknown>>): CreateCardInput {
  const frontText = row.front_text;
  const backText = row.back_text;
  const effortLevel = row.effort_level;
  const tags = row.tags;

  if (typeof frontText !== "string" || typeof backText !== "string") {
    throw new Error("INSERT INTO cards requires front_text and back_text");
  }

  if (effortLevel !== "fast" && effortLevel !== "medium" && effortLevel !== "long") {
    throw new Error("INSERT INTO cards requires effort_level to be fast, medium, or long");
  }

  return {
    frontText,
    backText,
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
    effortLevel,
  };
}

function toCreateDeckInput(row: Readonly<Record<string, unknown>>): CreateDeckInput {
  const name = row.name;
  const effortLevels = row.effort_levels;
  const tags = row.tags;

  if (typeof name !== "string") {
    throw new Error("INSERT INTO decks requires name");
  }

  return {
    name,
    filterDefinition: {
      version: 2,
      effortLevels: Array.isArray(effortLevels)
        ? effortLevels.filter((item): item is Card["effortLevel"] => item === "fast" || item === "medium" || item === "long")
        : [],
      tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
    },
  };
}

function toResolvedCardUpdateInput(existingCard: Card, row: Readonly<Record<string, unknown>>): UpdateCardInput {
  const frontText = row.front_text;
  const backText = row.back_text;
  const tags = row.tags;
  const effortLevel = row.effort_level;

  return {
    frontText: typeof frontText === "string" ? frontText : existingCard.frontText,
    backText: typeof backText === "string" ? backText : existingCard.backText,
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : existingCard.tags,
    effortLevel: effortLevel === "fast" || effortLevel === "medium" || effortLevel === "long"
      ? effortLevel
      : existingCard.effortLevel,
  };
}

function toResolvedDeckUpdateInput(existingDeck: Deck, row: Readonly<Record<string, unknown>>): UpdateDeckInput {
  const name = row.name;
  const effortLevels = row.effort_levels;
  const tags = row.tags;

  return {
    name: typeof name === "string" ? name : existingDeck.name,
    filterDefinition: {
      version: 2,
      effortLevels: Array.isArray(effortLevels)
        ? effortLevels.filter((item): item is Card["effortLevel"] => item === "fast" || item === "medium" || item === "long")
        : existingDeck.filterDefinition.effortLevels,
      tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : existingDeck.filterDefinition.tags,
    },
  };
}

function rowFromInsert(
  columnNames: ReadonlyArray<string>,
  values: ReadonlyArray<unknown>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(columnNames.map((columnName, index) => [columnName, values[index]] as const));
}

function ensureLocalWorkspace(
  dependencies: WebLocalToolExecutorDependencies,
): Readonly<{
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
    activeWorkspace: dependencies.activeWorkspace,
    snapshot: dependencies.getLocalSnapshot(),
  };
}

async function executeSqlLocally(
  dependencies: WebLocalToolExecutorDependencies,
  activeWorkspace: WorkspaceSummary,
  snapshot: MutableSnapshot,
  sql: string,
): Promise<Readonly<{
  payload: SqlExecutionPayload;
  didMutateAppState: boolean;
}>> {
  const statement = parseSqlStatement(sql);

  if (statement.type === "show_tables") {
    const rows = getSqlResourceDescriptors()
      .filter((descriptor) => statement.likePattern === null || likePatternToRegExp(statement.likePattern).test(descriptor.resourceName))
      .map((descriptor) => ({
        table_name: descriptor.resourceName,
        writable: descriptor.writable,
        description: descriptor.description,
      }));
    return {
      payload: {
        statementType: "show_tables",
        resource: null,
        sql,
        normalizedSql: statement.normalizedSql,
        rows,
        rowCount: rows.length,
        limit: null,
        offset: null,
        hasMore: false,
      },
      didMutateAppState: false,
    };
  }

  if (statement.type === "describe") {
    const rows = getSqlResourceDescriptor(statement.resourceName).columns.map((column) => ({
      column_name: column.columnName,
      type: column.type,
      nullable: column.nullable,
      read_only: column.readOnly,
      filterable: column.filterable,
      sortable: column.sortable,
      description: column.description,
    }));
    return {
      payload: {
        statementType: "describe",
        resource: statement.resourceName,
        sql,
        normalizedSql: statement.normalizedSql,
        rows,
        rowCount: rows.length,
        limit: null,
        offset: null,
        hasMore: false,
      },
      didMutateAppState: false,
    };
  }

  if (statement.type === "select") {
    const rows = loadSelectRows(activeWorkspace, snapshot, statement.source.resourceName);
    const result = executeSqlSelect(statement, rows, MAX_SQL_LIMIT);
    return {
      payload: {
        statementType: "select",
        resource: statement.source.resourceName,
        sql,
        normalizedSql: statement.normalizedSql,
        rows: result.rows,
        rowCount: result.rowCount,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
      didMutateAppState: false,
    };
  }

  if (statement.type === "insert" && statement.resourceName === "cards") {
    const createdCards = await Promise.all(
      statement.rows.map((values) => dependencies.createCardItem(toCreateCardInput(rowFromInsert(statement.columnNames, values)))),
    );
    return {
      payload: {
        statementType: "insert",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: createdCards.map(toCardRow),
        affectedCount: createdCards.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "insert" && statement.resourceName === "decks") {
    const createdDecks = await Promise.all(
      statement.rows.map((values) => dependencies.createDeckItem(toCreateDeckInput(rowFromInsert(statement.columnNames, values)))),
    );
    return {
      payload: {
        statementType: "insert",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: createdDecks.map(toDeckRow),
        affectedCount: createdDecks.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "update" && statement.resourceName === "cards") {
    const currentRows = executeSqlSelect({
      type: "select",
      source: {
        resourceName: "cards",
        unnestAlias: null,
        unnestColumnName: null,
      },
      selectItems: [{ type: "wildcard" }],
      predicateClauses: statement.predicateClauses,
      groupBy: [],
      orderBy: [],
      limit: MAX_SQL_LIMIT,
      offset: 0,
      normalizedSql: statement.normalizedSql,
    }, loadSelectRows(activeWorkspace, snapshot, "cards"), Number.MAX_SAFE_INTEGER).rows;
    const updatedCards = await Promise.all(currentRows.map((row) => {
      const cardId = row.card_id;
      if (typeof cardId !== "string") {
        throw new Error("Expected card_id in selected row");
      }

      const assignmentRow = Object.fromEntries(statement.assignments.map((assignment) => [assignment.columnName, assignment.value] as const));
      return dependencies.updateCardItem(cardId, toResolvedCardUpdateInput(findCard(snapshot, cardId), assignmentRow));
    }));
    return {
      payload: {
        statementType: "update",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: updatedCards.map(toCardRow),
        affectedCount: updatedCards.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "update" && statement.resourceName === "decks") {
    const currentRows = executeSqlSelect({
      type: "select",
      source: {
        resourceName: "decks",
        unnestAlias: null,
        unnestColumnName: null,
      },
      selectItems: [{ type: "wildcard" }],
      predicateClauses: statement.predicateClauses,
      groupBy: [],
      orderBy: [],
      limit: MAX_SQL_LIMIT,
      offset: 0,
      normalizedSql: statement.normalizedSql,
    }, loadSelectRows(activeWorkspace, snapshot, "decks"), Number.MAX_SAFE_INTEGER).rows;
    const updatedDecks = await Promise.all(currentRows.map((row) => {
      const deckId = row.deck_id;
      if (typeof deckId !== "string") {
        throw new Error("Expected deck_id in selected row");
      }

      const assignmentRow = Object.fromEntries(statement.assignments.map((assignment) => [assignment.columnName, assignment.value] as const));
      return dependencies.updateDeckItem(deckId, toResolvedDeckUpdateInput(findDeck(snapshot, deckId), assignmentRow));
    }));
    return {
      payload: {
        statementType: "update",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: updatedDecks.map(toDeckRow),
        affectedCount: updatedDecks.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "delete" && statement.resourceName === "cards") {
    const currentRows = executeSqlSelect({
      type: "select",
      source: {
        resourceName: "cards",
        unnestAlias: null,
        unnestColumnName: null,
      },
      selectItems: [{ type: "wildcard" }],
      predicateClauses: statement.predicateClauses,
      groupBy: [],
      orderBy: [],
      limit: MAX_SQL_LIMIT,
      offset: 0,
      normalizedSql: statement.normalizedSql,
    }, loadSelectRows(activeWorkspace, snapshot, "cards"), Number.MAX_SAFE_INTEGER).rows;
    const cardIds = currentRows.map((row) => {
      const cardId = row.card_id;
      if (typeof cardId !== "string") {
        throw new Error("Expected card_id in selected row");
      }
      return cardId;
    });
    await Promise.all(cardIds.map((cardId) => dependencies.deleteCardItem(cardId)));
    return {
      payload: {
        statementType: "delete",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: cardIds.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "delete" && statement.resourceName === "decks") {
    const currentRows = executeSqlSelect({
      type: "select",
      source: {
        resourceName: "decks",
        unnestAlias: null,
        unnestColumnName: null,
      },
      selectItems: [{ type: "wildcard" }],
      predicateClauses: statement.predicateClauses,
      groupBy: [],
      orderBy: [],
      limit: MAX_SQL_LIMIT,
      offset: 0,
      normalizedSql: statement.normalizedSql,
    }, loadSelectRows(activeWorkspace, snapshot, "decks"), Number.MAX_SAFE_INTEGER).rows;
    const deckIds = currentRows.map((row) => {
      const deckId = row.deck_id;
      if (typeof deckId !== "string") {
        throw new Error("Expected deck_id in selected row");
      }
      return deckId;
    });
    await Promise.all(deckIds.map((deckId) => dependencies.deleteDeckItem(deckId)));
    return {
      payload: {
        statementType: "delete",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: deckIds.length,
      },
      didMutateAppState: true,
    };
  }

  throw new Error("Unsupported SQL statement");
}

/**
 * Builds a browser-local AI tool executor that mirrors the backend SQL
 * surface while using the web app sync snapshot and IndexedDB-backed writes.
 */
export function createLocalToolExecutor(
  dependencies: WebLocalToolExecutorDependencies,
): Readonly<{
  execute: (toolCallRequest: LocalToolCallRequest) => Promise<LocalToolExecutionResult>;
}> {
  return {
    async execute(toolCallRequest: LocalToolCallRequest): Promise<LocalToolExecutionResult> {
      const { activeWorkspace, snapshot } = ensureLocalWorkspace(dependencies);

      switch (toolCallRequest.name) {
      case "sql": {
        const input = parseSqlInput(toolCallRequest);
        const result = await executeSqlLocally(dependencies, activeWorkspace, snapshot, input.sql);
        return {
          output: JSON.stringify(result.payload),
          didMutateAppState: result.didMutateAppState,
        };
      }
      case "get_cloud_settings":
        parseEmptyObjectInput(toolCallRequest);
        if (snapshot.cloudSettings === null) {
          throw new Error("Cloud settings are not loaded");
        }

        return {
          output: JSON.stringify(snapshot.cloudSettings satisfies CloudSettings),
          didMutateAppState: false,
        };
      case "list_outbox": {
        const input = parseListOutboxInput(toolCallRequest);
        return {
          output: JSON.stringify(
            makeOutboxPayload(
              snapshot,
              activeWorkspace.workspaceId,
              getPageStartIndex(input.cursor),
              normalizeLimit(input.limit),
            ),
          ),
          didMutateAppState: false,
        };
      }
      default:
        throw new Error(`Unsupported AI tool: ${toolCallRequest.name}`);
      }
    },
  };
}
