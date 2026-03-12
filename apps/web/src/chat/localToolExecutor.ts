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
  isCardDue,
  isCardNew,
  isCardReviewed,
  makeWorkspaceTagsSummary,
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
  Workspace,
  WorkspaceSummary,
} from "../types";
import {
  getSqlResourceDescriptors,
  parseSqlStatement,
  type ParsedSqlStatement,
  type SqlPredicate,
  type SqlResourceName,
  type SqlSelectOrderBy,
} from "../../../backend/src/aiTools/sqlDialect";

type SqlRowScalar = string | number | boolean | null;
type SqlRowValue = SqlRowScalar | ReadonlyArray<string> | ReadonlyArray<number>;
type SqlRow = Readonly<Record<string, SqlRowValue>>;

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

function makeWorkspace(activeWorkspace: WorkspaceSummary): Workspace {
  return {
    workspaceId: activeWorkspace.workspaceId,
    name: activeWorkspace.name,
    createdAt: activeWorkspace.createdAt,
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

function compareRowValues(left: SqlRowValue | undefined, right: SqlRowValue | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined || left === null) {
    return right === undefined || right === null ? 0 : -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    const leftText = Array.isArray(left) ? left.join("\u0000") : String(left);
    const rightText = Array.isArray(right) ? right.join("\u0000") : String(right);
    return leftText.localeCompare(rightText);
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function valuesEqual(left: SqlRowValue | undefined, right: string | number | boolean | null): boolean {
  if (left === undefined || Array.isArray(left)) {
    return false;
  }

  return left === right;
}

function normalizeStringArray(value: SqlRowValue | undefined): ReadonlyArray<string> {
  if (value === undefined || value === null || Array.isArray(value) === false) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeSearchableText(value: SqlRowValue): string {
  if (Array.isArray(value)) {
    return value.join(" ").toLowerCase();
  }

  if (value === null) {
    return "";
  }

  return String(value).toLowerCase();
}

function rowMatchesPredicate(row: SqlRow, predicate: SqlPredicate): boolean {
  if (predicate.type === "match") {
    const normalizedQuery = predicate.query.trim().toLowerCase();
    if (normalizedQuery === "") {
      throw new Error("MATCH query must not be empty");
    }

    return Object.values(row).some((value) => normalizeSearchableText(value).includes(normalizedQuery));
  }

  const columnValue = row[predicate.columnName];
  if (predicate.type === "comparison") {
    return valuesEqual(columnValue, predicate.value);
  }

  if (predicate.type === "in") {
    return predicate.values.some((value) => valuesEqual(columnValue, value));
  }

  if (predicate.type === "is_null") {
    return columnValue === null;
  }

  return normalizeStringArray(columnValue).some((value) => predicate.values.includes(value));
}

function applyPredicates(rows: ReadonlyArray<SqlRow>, predicates: ReadonlyArray<SqlPredicate>): ReadonlyArray<SqlRow> {
  if (predicates.length === 0) {
    return rows;
  }

  return rows.filter((row) => predicates.every((predicate) => rowMatchesPredicate(row, predicate)));
}

function applyOrderBy(rows: ReadonlyArray<SqlRow>, orderBy: ReadonlyArray<SqlSelectOrderBy>): ReadonlyArray<SqlRow> {
  if (orderBy.length === 0) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const item of orderBy) {
      const comparison = compareRowValues(left[item.columnName], right[item.columnName]);
      if (comparison !== 0) {
        return item.direction === "desc" ? -comparison : comparison;
      }
    }

    return 0;
  });
}

function paginateRows(
  rows: ReadonlyArray<SqlRow>,
  limit: number,
  offset: number,
): Readonly<{ rows: ReadonlyArray<SqlRow>; hasMore: boolean }> {
  const pagedRows = rows.slice(offset, offset + limit);
  return {
    rows: pagedRows,
    hasMore: offset + pagedRows.length < rows.length,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likePatternToRegExp(value: string): RegExp {
  const escaped = escapeRegExp(value).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizeSqlLimit(limit: number | null): number {
  if (limit === null) {
    return MAX_SQL_LIMIT;
  }

  if (limit < 1) {
    throw new Error("LIMIT must be greater than 0");
  }

  return Math.min(limit, MAX_SQL_LIMIT);
}

function normalizeSqlOffset(offset: number | null): number {
  if (offset === null) {
    return 0;
  }

  if (offset < 0) {
    throw new Error("OFFSET must be a non-negative integer");
  }

  return offset;
}

function loadSelectRows(
  session: SessionInfo,
  activeWorkspace: WorkspaceSummary,
  snapshot: MutableSnapshot,
  resourceName: SqlResourceName,
): ReadonlyArray<SqlRow> {
  if (resourceName === "workspace_context") {
    const workspace = makeWorkspace(activeWorkspace);
    const homeSnapshot = makeHomeSnapshot(snapshot);
    return [{
      workspace_id: workspace.workspaceId,
      workspace_name: workspace.name,
      total_cards: homeSnapshot.totalCards,
      due_cards: homeSnapshot.dueCount,
      new_cards: homeSnapshot.newCount,
      reviewed_cards: homeSnapshot.reviewedCount,
    }];
  }

  if (resourceName === "scheduler_settings") {
    if (snapshot.workspaceSettings === null) {
      throw new Error("Workspace scheduler settings are not loaded");
    }

    return [{
      algorithm: snapshot.workspaceSettings.algorithm,
      desired_retention: snapshot.workspaceSettings.desiredRetention,
      learning_steps_minutes: snapshot.workspaceSettings.learningStepsMinutes,
      relearning_steps_minutes: snapshot.workspaceSettings.relearningStepsMinutes,
      maximum_interval_days: snapshot.workspaceSettings.maximumIntervalDays,
      enable_fuzz: snapshot.workspaceSettings.enableFuzz,
    }];
  }

  if (resourceName === "tags_summary") {
    const payload = makeWorkspaceTagsSummary(currentActiveCards(snapshot));
    return payload.tags.map((tag) => ({
      tag: tag.tag,
      cards_count: tag.cardsCount,
      total_cards: payload.totalCards,
    }));
  }

  if (resourceName === "cards") {
    return currentActiveCards(snapshot).map(toCardRow);
  }

  if (resourceName === "due_cards") {
    return dueCards(snapshot).map(toCardRow);
  }

  if (resourceName === "decks") {
    return activeDecks(snapshot).map(toDeckRow);
  }

  void session;
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

async function executeSqlLocally(
  dependencies: WebLocalToolExecutorDependencies,
  session: SessionInfo,
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
    const descriptor = getSqlResourceDescriptors().find((item) => item.resourceName === statement.resourceName);
    if (descriptor === undefined) {
      throw new Error(`Unknown resource: ${statement.resourceName}`);
    }

    const rows = descriptor.columns.map((column) => ({
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
    const limit = normalizeSqlLimit(statement.limit);
    const offset = normalizeSqlOffset(statement.offset);
    const rows = loadSelectRows(session, activeWorkspace, snapshot, statement.resourceName);
    const filteredRows = applyPredicates(rows, statement.predicates);
    const orderedRows = applyOrderBy(filteredRows, statement.orderBy);
    const paginatedRows = paginateRows(orderedRows, limit, offset);
    return {
      payload: {
        statementType: "select",
        resource: statement.resourceName,
        sql,
        normalizedSql: statement.normalizedSql,
        rows: paginatedRows.rows,
        rowCount: paginatedRows.rows.length,
        limit,
        offset,
        hasMore: paginatedRows.hasMore,
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
    const currentRows = applyPredicates(loadSelectRows(session, activeWorkspace, snapshot, "cards"), statement.predicates);
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
    const currentRows = applyPredicates(loadSelectRows(session, activeWorkspace, snapshot, "decks"), statement.predicates);
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
    const currentRows = applyPredicates(loadSelectRows(session, activeWorkspace, snapshot, "cards"), statement.predicates);
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
    const currentRows = applyPredicates(loadSelectRows(session, activeWorkspace, snapshot, "decks"), statement.predicates);
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
      const { session, activeWorkspace, snapshot } = ensureLocalWorkspace(dependencies);

      switch (toolCallRequest.name) {
      case "sql": {
        const input = parseSqlInput(toolCallRequest);
        const result = await executeSqlLocally(dependencies, session, activeWorkspace, snapshot, input.sql);
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
