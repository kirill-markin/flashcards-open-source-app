import { randomUUID } from "node:crypto";
import {
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "./db";
import { HttpError } from "./errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "./lww";
import {
  buildTokenizedOrLikeClause,
  MAX_SEARCH_TOKEN_COUNT,
  tokenizeSearchText,
} from "./searchTokens";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  type CursorPageInput,
} from "./pagination";
import { findLatestSyncChangeId, insertSyncChange } from "./syncChanges";
import type { EffortLevel } from "./cards";

type TimestampValue = Date | string;
type ErrorFactory = (message: string) => Error;

export type DeckRow = Readonly<{
  deck_id: string;
  workspace_id: string;
  name: string;
  filter_definition: unknown;
  created_at: TimestampValue;
  client_updated_at: TimestampValue;
  last_modified_by_device_id: string;
  last_operation_id: string;
  updated_at: TimestampValue;
  deleted_at: TimestampValue | null;
}>;

type RecordValue = Record<string, unknown>;

export type DeckFilterDefinition = Readonly<{
  version: 2;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

export type Deck = Readonly<{
  deckId: string;
  workspaceId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type DeckPage = Readonly<{
  decks: ReadonlyArray<Deck>;
  nextCursor: string | null;
}>;

export type CreateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
}>;

export type UpdateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
}>;

export type DeckMutationMetadata = LwwMetadata;

export type DeckSnapshotInput = Readonly<{
  deckId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  deletedAt: string | null;
}>;

export type DeckMutationResult = Readonly<{
  deck: Deck;
  applied: boolean;
  changeId: number | null;
}>;

export type BulkCreateDeckItem = Readonly<{
  input: CreateDeckInput;
  metadata: DeckMutationMetadata;
}>;

export type BulkUpdateDeckItem = Readonly<{
  deckId: string;
  input: UpdateDeckInput;
  metadata: DeckMutationMetadata;
}>;

export type BulkDeleteDeckItem = Readonly<{
  deckId: string;
  metadata: DeckMutationMetadata;
}>;

export type BulkDeleteDecksResult = Readonly<{
  deletedDeckIds: ReadonlyArray<string>;
  deletedCount: number;
}>;

const MAX_DECK_BATCH_SIZE = 100;

type DeckPageCursor = Readonly<{
  createdAt: string;
  deckId: string;
}>;

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function createRequestError(message: string): HttpError {
  return new HttpError(400, message);
}

function throwError(errorFactory: ErrorFactory, message: string): never {
  throw errorFactory(message);
}

function expectRecord(
  value: unknown,
  context: string,
  errorFactory: ErrorFactory,
): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return throwError(errorFactory, `${context} must be a JSON object`);
  }

  return value as RecordValue;
}

function expectOnlyAllowedKeys(
  value: RecordValue,
  allowedKeys: ReadonlyArray<string>,
  context: string,
  errorFactory: ErrorFactory,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throwError(errorFactory, `${context} contains unsupported field: ${key}`);
    }
  }
}

function expectNonEmptyString(
  value: unknown,
  fieldName: string,
  errorFactory: ErrorFactory,
): string {
  if (typeof value !== "string") {
    return throwError(errorFactory, `${fieldName} must be a string`);
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return throwError(errorFactory, `${fieldName} must not be empty`);
  }

  return trimmedValue;
}

function normalizeDeckEffortLevels(
  value: unknown,
  fieldName: string,
  errorFactory: ErrorFactory,
): ReadonlyArray<EffortLevel> {
  if (!Array.isArray(value)) {
    return throwError(errorFactory, `${fieldName} must be an array`);
  }

  const uniqueValues = new Set<EffortLevel>();
  for (const item of value) {
    if (item !== "fast" && item !== "medium" && item !== "long") {
      throwError(errorFactory, `${fieldName} must contain only fast, medium, or long`);
    }

    uniqueValues.add(item);
  }

  return [...uniqueValues];
}

function normalizeDeckTags(
  value: unknown,
  fieldName: string,
  errorFactory: ErrorFactory,
): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return throwError(errorFactory, `${fieldName} must be an array of strings`);
  }

  const uniqueTags = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throwError(errorFactory, `${fieldName} must be an array of strings`);
    }

    const normalizedTag = item.trim();
    if (normalizedTag === "") {
      throwError(errorFactory, `${fieldName} must contain only non-empty tags`);
    }

    uniqueTags.add(normalizedTag);
  }

  return [...uniqueTags];
}

function parseDeckFilterDefinitionWithFactory(
  value: unknown,
  errorFactory: ErrorFactory,
): DeckFilterDefinition {
  const record = expectRecord(value, "filterDefinition", errorFactory);
  expectOnlyAllowedKeys(record, ["version", "effortLevels", "tags"], "filterDefinition", errorFactory);

  if (record.version !== 2) {
    throwError(errorFactory, "filterDefinition version must be 2");
  }

  return {
    version: 2,
    effortLevels: normalizeDeckEffortLevels(record.effortLevels, "filterDefinition effortLevels", errorFactory),
    tags: normalizeDeckTags(record.tags, "filterDefinition tags", errorFactory),
  };
}

export function mapDeck(row: DeckRow): Deck {
  return {
    deckId: row.deck_id,
    workspaceId: row.workspace_id,
    name: row.name,
    filterDefinition: parseDeckFilterDefinitionWithFactory(
      row.filter_definition,
      (message) => new Error(`Stored deck filter definition is invalid: ${message}`),
    ),
    createdAt: toIsoString(row.created_at),
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByDeviceId: row.last_modified_by_device_id,
    lastOperationId: row.last_operation_id,
    updatedAt: toIsoString(row.updated_at),
    deletedAt: row.deleted_at === null ? null : toIsoString(row.deleted_at),
  };
}

function decodeDeckPageCursor(cursor: string): DeckPageCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 2) {
    throw createRequestError("cursor does not match the requested deck order");
  }

  const createdAt = decodedCursor.values[0];
  const deckId = decodedCursor.values[1];
  if (typeof createdAt !== "string" || typeof deckId !== "string") {
    throw createRequestError("cursor does not match the requested deck order");
  }

  return {
    createdAt,
    deckId,
  };
}

function normalizeDeckMutationMetadata(metadata: DeckMutationMetadata): DeckMutationMetadata {
  return {
    clientUpdatedAt: normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByDeviceId: metadata.lastModifiedByDeviceId,
    lastOperationId: metadata.lastOperationId,
  };
}

function toDeckLwwMetadata(deck: Deck): DeckMutationMetadata {
  return {
    clientUpdatedAt: deck.clientUpdatedAt,
    lastModifiedByDeviceId: deck.lastModifiedByDeviceId,
    lastOperationId: deck.lastOperationId,
  };
}

function toDeckPayloadJson(deck: Deck): string {
  return JSON.stringify(deck);
}

async function recordDeckSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  deck: Deck,
): Promise<number> {
  return insertSyncChange(
    executor,
    workspaceId,
    "deck",
    deck.deckId,
    "upsert",
    deck.lastModifiedByDeviceId,
    deck.lastOperationId,
    toDeckPayloadJson(deck),
  );
}

function normalizeDeckSnapshotInput(input: DeckSnapshotInput): DeckSnapshotInput {
  return {
    deckId: input.deckId,
    name: input.name,
    filterDefinition: input.filterDefinition,
    createdAt: normalizeIsoTimestamp(input.createdAt, "createdAt"),
    deletedAt: input.deletedAt === null ? null : normalizeIsoTimestamp(input.deletedAt, "deletedAt"),
  };
}

export function parseDeckFilterDefinition(value: unknown): DeckFilterDefinition {
  return parseDeckFilterDefinitionWithFactory(value, createRequestError);
}

function normalizeDeckName(name: string): string {
  return expectNonEmptyString(name, "name", createRequestError);
}

function normalizeTypedDeckFilterDefinition(filterDefinition: DeckFilterDefinition): DeckFilterDefinition {
  return {
    version: 2,
    effortLevels: normalizeDeckEffortLevels(
      filterDefinition.effortLevels,
      "filterDefinition effortLevels",
      createRequestError,
    ),
    tags: normalizeDeckTags(
      filterDefinition.tags,
      "filterDefinition tags",
      createRequestError,
    ),
  };
}

function normalizeCreateDeckInput(input: CreateDeckInput): CreateDeckInput {
  return {
    name: normalizeDeckName(input.name),
    filterDefinition: normalizeTypedDeckFilterDefinition(input.filterDefinition),
  };
}

function normalizeUpdateDeckInput(input: UpdateDeckInput): UpdateDeckInput {
  return {
    name: normalizeDeckName(input.name),
    filterDefinition: normalizeTypedDeckFilterDefinition(input.filterDefinition),
  };
}

function validateDeckBatchCount(count: number): void {
  if (count < 1) {
    throw createRequestError("Deck batch must contain at least one item");
  }

  if (count > MAX_DECK_BATCH_SIZE) {
    throw createRequestError(`Deck batch must contain at most ${MAX_DECK_BATCH_SIZE} items`);
  }
}

function validateUniqueDeckIds(deckIds: ReadonlyArray<string>): void {
  const uniqueDeckIds = new Set(deckIds);
  if (uniqueDeckIds.size !== deckIds.length) {
    throw createRequestError("Deck batch must not contain duplicate deckId values");
  }
}

export function parseCreateDeckInput(value: unknown): CreateDeckInput {
  const record = expectRecord(value, "request body", createRequestError);
  expectOnlyAllowedKeys(record, ["name", "filterDefinition"], "request body", createRequestError);

  return {
    name: expectNonEmptyString(record.name, "name", createRequestError),
    filterDefinition: parseDeckFilterDefinition(record.filterDefinition),
  };
}

export async function listDecksPage(
  userId: string,
  workspaceId: string,
  input: CursorPageInput,
): Promise<DeckPage> {
  if (input.limit < 1 || input.limit > MAX_DECK_BATCH_SIZE) {
    throw createRequestError(`limit must be an integer between 1 and ${MAX_DECK_BATCH_SIZE}`);
  }

  const decodedCursor = input.cursor === null ? null : decodeDeckPageCursor(input.cursor);
  const cursorClause = decodedCursor === null
    ? ""
    : "AND (created_at < $2 OR (created_at = $2 AND deck_id < $3))";
  const params = decodedCursor === null
    ? [workspaceId, input.limit + 1]
    : [workspaceId, new Date(decodedCursor.createdAt), decodedCursor.deckId, input.limit + 1];
  const limitParamIndex = decodedCursor === null ? 2 : 4;

  const result = await queryWithWorkspaceScope<DeckRow>(
    { userId, workspaceId },
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      cursorClause,
      "ORDER BY created_at DESC, deck_id DESC",
      `LIMIT $${limitParamIndex}`,
    ].join(" "),
    params,
  );

  const hasNextPage = result.rows.length > input.limit;
  const visibleRows = hasNextPage ? result.rows.slice(0, input.limit) : result.rows;
  const nextRow = hasNextPage ? visibleRows[visibleRows.length - 1] : undefined;

  return {
    decks: visibleRows.map(mapDeck),
    nextCursor: nextRow === undefined ? null : encodeOpaqueCursor([
      toIsoString(nextRow.created_at),
      nextRow.deck_id,
    ]),
  };
}

export async function listDecksInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<ReadonlyArray<Deck>> {
  const result = await executor.query<DeckRow>(
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      "ORDER BY created_at DESC, deck_id DESC",
    ].join(" "),
    [workspaceId],
  );

  return result.rows.map(mapDeck);
}

export async function getDeck(userId: string, workspaceId: string, deckId: string): Promise<Deck> {
  const result = await queryWithWorkspaceScope<DeckRow>(
    { userId, workspaceId },
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = $2 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId, deckId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Deck not found");
  }

  return mapDeck(row);
}

export async function getDecks(
  userId: string,
  workspaceId: string,
  deckIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<Deck>> {
  validateDeckBatchCount(deckIds.length);
  validateUniqueDeckIds(deckIds);

  const result = await queryWithWorkspaceScope<DeckRow>(
    { userId, workspaceId },
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = ANY($2::uuid[]) AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId, deckIds],
  );

  const decksById = new Map(result.rows.map((row) => {
    const deck = mapDeck(row);
    return [deck.deckId, deck] as const;
  }));

  return deckIds.map((deckId) => {
    const deck = decksById.get(deckId);
    if (deck === undefined) {
      throw new HttpError(404, `Deck not found: ${deckId}`);
    }

    return deck;
  });
}

export async function searchDecksPage(
  userId: string,
  workspaceId: string,
  searchText: string,
  input: CursorPageInput,
): Promise<DeckPage> {
  if (input.limit < 1 || input.limit > MAX_DECK_BATCH_SIZE) {
    throw createRequestError(`limit must be an integer between 1 and ${MAX_DECK_BATCH_SIZE}`);
  }

  const searchTokens = tokenizeSearchText(searchText, MAX_SEARCH_TOKEN_COUNT);
  if (searchTokens.length === 0) {
    throw createRequestError("query must not be empty");
  }

  const searchClauseResult = buildTokenizedOrLikeClause(searchTokens, 1, [
    (paramIndex) => `lower(name) LIKE $${paramIndex}`,
    (paramIndex) => `EXISTS (SELECT 1 FROM jsonb_array_elements_text(filter_definition->'tags') AS tag WHERE lower(tag) LIKE $${paramIndex})`,
    (paramIndex) => `EXISTS (SELECT 1 FROM jsonb_array_elements_text(filter_definition->'effortLevels') AS effort_level WHERE lower(effort_level) LIKE $${paramIndex})`,
  ]);
  const decodedCursor = input.cursor === null ? null : decodeDeckPageCursor(input.cursor);
  const cursorClause = decodedCursor === null
    ? ""
    : `AND (created_at < $${searchClauseResult.params.length + 2} OR (created_at = $${searchClauseResult.params.length + 2} AND deck_id < $${searchClauseResult.params.length + 3}))`;
  const limitParamIndex = searchClauseResult.params.length + (decodedCursor === null ? 2 : 4);
  const params = decodedCursor === null
    ? [workspaceId, ...searchClauseResult.params, input.limit + 1]
    : [
      workspaceId,
      ...searchClauseResult.params,
      new Date(decodedCursor.createdAt),
      decodedCursor.deckId,
      input.limit + 1,
    ];

  const result = await queryWithWorkspaceScope<DeckRow>(
    { userId, workspaceId },
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1",
      "AND deleted_at IS NULL",
      `AND (${searchClauseResult.clause})`,
      cursorClause,
      "ORDER BY created_at DESC, deck_id DESC",
      `LIMIT $${limitParamIndex}`,
    ].join(" "),
    params,
  );

  const hasNextPage = result.rows.length > input.limit;
  const visibleRows = hasNextPage ? result.rows.slice(0, input.limit) : result.rows;
  const nextRow = hasNextPage ? visibleRows[visibleRows.length - 1] : undefined;

  return {
    decks: visibleRows.map(mapDeck),
    nextCursor: nextRow === undefined ? null : encodeOpaqueCursor([
      toIsoString(nextRow.created_at),
      nextRow.deck_id,
    ]),
  };
}

export async function createDeck(
  userId: string,
  workspaceId: string,
  input: CreateDeckInput,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => createDeckInExecutor(executor, workspaceId, input, metadata),
  );
}

export async function upsertDeckSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: DeckSnapshotInput,
  metadata: DeckMutationMetadata,
): Promise<DeckMutationResult> {
  const normalizedInput = normalizeDeckSnapshotInput(input);
  const normalizedMetadata = normalizeDeckMutationMetadata(metadata);

  const existingResult = await executor.query<DeckRow>(
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, normalizedInput.deckId],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow === undefined) {
    const insertResult = await executor.query<DeckRow>(
      [
        "INSERT INTO content.decks",
        "(",
        "deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
        "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
        ")",
        "VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now(), $9)",
        "RETURNING deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
        "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      ].join(" "),
      [
        normalizedInput.deckId,
        workspaceId,
        normalizedInput.name,
        JSON.stringify(normalizedInput.filterDefinition),
        normalizedInput.createdAt,
        normalizedMetadata.clientUpdatedAt,
        normalizedMetadata.lastModifiedByDeviceId,
        normalizedMetadata.lastOperationId,
        normalizedInput.deletedAt,
      ],
    );

    const insertedRow = insertResult.rows[0];
    if (insertedRow === undefined) {
      throw new Error("Deck insert did not return a row");
    }

    const insertedDeck = mapDeck(insertedRow);
    const changeId = await recordDeckSyncChange(executor, workspaceId, insertedDeck);

    return {
      deck: insertedDeck,
      applied: true,
      changeId,
    };
  }

  const existingDeck = mapDeck(existingRow);
  if (incomingLwwMetadataWins(normalizedMetadata, toDeckLwwMetadata(existingDeck)) === false) {
    return {
      deck: existingDeck,
      applied: false,
      changeId: await findLatestSyncChangeId(executor, workspaceId, "deck", existingDeck.deckId),
    };
  }

  const updateResult = await executor.query<DeckRow>(
    [
      "UPDATE content.decks",
      "SET name = $1, filter_definition = $2::jsonb, created_at = $3, deleted_at = $4,",
      "client_updated_at = $5, last_modified_by_device_id = $6, last_operation_id = $7, updated_at = now()",
      "WHERE workspace_id = $8 AND deck_id = $9",
      "RETURNING deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
    ].join(" "),
    [
      normalizedInput.name,
      JSON.stringify(normalizedInput.filterDefinition),
      normalizedInput.createdAt,
      normalizedInput.deletedAt,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByDeviceId,
      normalizedMetadata.lastOperationId,
      workspaceId,
      normalizedInput.deckId,
    ],
  );

  const updatedRow = updateResult.rows[0];
  if (updatedRow === undefined) {
    throw new Error("Deck update did not return a row");
  }

  const updatedDeck = mapDeck(updatedRow);
  const changeId = await recordDeckSyncChange(executor, workspaceId, updatedDeck);

  return {
    deck: updatedDeck,
    applied: true,
    changeId,
  };
}

export async function upsertDeckSnapshot(
  userId: string,
  workspaceId: string,
  input: DeckSnapshotInput,
  metadata: DeckMutationMetadata,
): Promise<DeckMutationResult> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => upsertDeckSnapshotInExecutor(executor, workspaceId, input, metadata),
  );
}

export async function createDeckInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CreateDeckInput,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  const normalizedInput = normalizeCreateDeckInput(input);
  const now = normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt");
  const result = await upsertDeckSnapshotInExecutor(
    executor,
    workspaceId,
    {
      deckId: randomUUID(),
      name: normalizedInput.name,
      filterDefinition: normalizedInput.filterDefinition,
      createdAt: now,
      deletedAt: null,
    },
    metadata,
  );

  return result.deck;
}

export async function updateDeckInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deckId: string,
  input: UpdateDeckInput,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  const existingResult = await executor.query<DeckRow>(
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = $2 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId, deckId],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow === undefined) {
    throw new HttpError(404, "Deck not found");
  }

  const existingDeck = mapDeck(existingRow);
  const normalizedInput = normalizeUpdateDeckInput(input);
  const result = await upsertDeckSnapshotInExecutor(
    executor,
    workspaceId,
    {
      deckId,
      name: normalizedInput.name,
      filterDefinition: normalizedInput.filterDefinition,
      createdAt: existingDeck.createdAt,
      deletedAt: null,
    },
    metadata,
  );

  return result.deck;
}

export async function updateDeck(
  userId: string,
  workspaceId: string,
  deckId: string,
  input: UpdateDeckInput,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => updateDeckInExecutor(executor, workspaceId, deckId, input, metadata),
  );
}

export async function deleteDeckInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deckId: string,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  const existingResult = await executor.query<DeckRow>(
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = $2 AND deleted_at IS NULL",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, deckId],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow === undefined) {
    throw new HttpError(404, "Deck not found");
  }

  const existingDeck = mapDeck(existingRow);
  const normalizedMetadata = normalizeDeckMutationMetadata(metadata);
  const result = await upsertDeckSnapshotInExecutor(
    executor,
    workspaceId,
    {
      deckId,
      name: existingDeck.name,
      filterDefinition: existingDeck.filterDefinition,
      createdAt: existingDeck.createdAt,
      deletedAt: normalizedMetadata.clientUpdatedAt,
    },
    normalizedMetadata,
  );

  return result.deck;
}

export async function deleteDeck(
  userId: string,
  workspaceId: string,
  deckId: string,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => deleteDeckInExecutor(executor, workspaceId, deckId, metadata),
  );
}

export async function createDecks(
  userId: string,
  workspaceId: string,
  items: ReadonlyArray<BulkCreateDeckItem>,
): Promise<ReadonlyArray<Deck>> {
  validateDeckBatchCount(items.length);

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const createdDecks: Array<Deck> = [];
    for (const item of items) {
      createdDecks.push(await createDeckInExecutor(executor, workspaceId, item.input, item.metadata));
    }

    return createdDecks;
  });
}

export async function updateDecks(
  userId: string,
  workspaceId: string,
  items: ReadonlyArray<BulkUpdateDeckItem>,
): Promise<ReadonlyArray<Deck>> {
  validateDeckBatchCount(items.length);
  validateUniqueDeckIds(items.map((item) => item.deckId));

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const updatedDecks: Array<Deck> = [];
    for (const item of items) {
      updatedDecks.push(await updateDeckInExecutor(executor, workspaceId, item.deckId, item.input, item.metadata));
    }

    return updatedDecks;
  });
}

export async function deleteDecks(
  userId: string,
  workspaceId: string,
  items: ReadonlyArray<BulkDeleteDeckItem>,
): Promise<BulkDeleteDecksResult> {
  validateDeckBatchCount(items.length);
  validateUniqueDeckIds(items.map((item) => item.deckId));

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const deletedDeckIds: Array<string> = [];
    for (const item of items) {
      const deletedDeck = await deleteDeckInExecutor(executor, workspaceId, item.deckId, item.metadata);
      deletedDeckIds.push(deletedDeck.deckId);
    }

    return {
      deletedDeckIds,
      deletedCount: deletedDeckIds.length,
    };
  });
}
