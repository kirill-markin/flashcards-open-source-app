import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "./db";
import { HttpError } from "./errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "./lww";
import { findLatestSyncChangeId, insertSyncChange } from "./syncChanges";
import type { EffortLevel } from "./cards";

type TimestampValue = Date | string;
type ErrorFactory = (message: string) => Error;

type DeckRow = Readonly<{
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

export type CreateDeckInput = Readonly<{
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

function mapDeck(row: DeckRow): Deck {
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

export function parseCreateDeckInput(value: unknown): CreateDeckInput {
  const record = expectRecord(value, "request body", createRequestError);
  expectOnlyAllowedKeys(record, ["name", "filterDefinition"], "request body", createRequestError);

  return {
    name: expectNonEmptyString(record.name, "name", createRequestError),
    filterDefinition: parseDeckFilterDefinition(record.filterDefinition),
  };
}

export async function listDecks(workspaceId: string): Promise<ReadonlyArray<Deck>> {
  const result = await query<DeckRow>(
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      "ORDER BY updated_at DESC, created_at DESC",
    ].join(" "),
    [workspaceId],
  );

  return result.rows.map(mapDeck);
}

export async function createDeck(
  workspaceId: string,
  input: CreateDeckInput,
  metadata: DeckMutationMetadata,
): Promise<Deck> {
  const now = normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt");
  const result = await upsertDeckSnapshot(
    workspaceId,
    {
      deckId: randomUUID(),
      name: input.name,
      filterDefinition: input.filterDefinition,
      createdAt: now,
      deletedAt: null,
    },
    metadata,
  );

  return result.deck;
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
  workspaceId: string,
  input: DeckSnapshotInput,
  metadata: DeckMutationMetadata,
): Promise<DeckMutationResult> {
  return transaction(async (executor) => upsertDeckSnapshotInExecutor(executor, workspaceId, input, metadata));
}
