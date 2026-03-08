import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "./db";
import { HttpError } from "./errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "./lww";
import type { EffortLevel } from "./cards";

type TimestampValue = Date | string;
type ErrorFactory = (message: string) => Error;

type DeckRow = Readonly<{
  deck_id: string;
  workspace_id: string;
  name: string;
  filter_definition: unknown;
  created_at: TimestampValue;
  server_version: string | number;
  client_updated_at: TimestampValue;
  last_modified_by_device_id: string;
  last_operation_id: string;
  updated_at: TimestampValue;
  deleted_at: TimestampValue | null;
}>;

type RecordValue = Record<string, unknown>;

export type DeckPredicate =
  | Readonly<{
    field: "effortLevel";
    operator: "in";
    values: ReadonlyArray<EffortLevel>;
  }>
  | Readonly<{
    field: "tags";
    operator: "containsAny" | "containsAll";
    values: ReadonlyArray<string>;
  }>;

export type DeckFilterDefinition = Readonly<{
  version: 1;
  combineWith: "and" | "or";
  predicates: ReadonlyArray<DeckPredicate>;
}>;

export type Deck = Readonly<{
  deckId: string;
  workspaceId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  serverVersion: number;
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
}>;

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function createRequestError(message: string): HttpError {
  return new HttpError(400, message);
}

function createStoredDataError(message: string): Error {
  return new Error(`Stored deck filter definition is invalid: ${message}`);
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

function normalizeEffortLevels(
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

  if (uniqueValues.size === 0) {
    return throwError(errorFactory, `${fieldName} must contain at least one value`);
  }

  return [...uniqueValues];
}

function normalizeTagValues(
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
    if (normalizedTag !== "") {
      uniqueTags.add(normalizedTag);
    }
  }

  if (uniqueTags.size === 0) {
    return throwError(errorFactory, `${fieldName} must contain at least one tag`);
  }

  return [...uniqueTags];
}

function parseDeckPredicateWithFactory(
  value: unknown,
  errorFactory: ErrorFactory,
): DeckPredicate {
  const record = expectRecord(value, "deck predicate", errorFactory);
  expectOnlyAllowedKeys(record, ["field", "operator", "values"], "deck predicate", errorFactory);

  const field = expectNonEmptyString(record.field, "deck predicate field", errorFactory);
  if (field === "effortLevel") {
    if (record.operator !== "in") {
      throwError(errorFactory, "effortLevel predicate operator must be in");
    }

    return {
      field: "effortLevel",
      operator: "in",
      values: normalizeEffortLevels(record.values, "deck predicate values", errorFactory),
    };
  }

  if (field === "tags") {
    if (record.operator !== "containsAny" && record.operator !== "containsAll") {
      throwError(errorFactory, "tags predicate operator must be containsAny or containsAll");
    }

    return {
      field: "tags",
      operator: record.operator,
      values: normalizeTagValues(record.values, "deck predicate values", errorFactory),
    };
  }

  return throwError(errorFactory, `deck predicate field is not supported: ${field}`);
}

function parseDeckFilterDefinitionWithFactory(
  value: unknown,
  errorFactory: ErrorFactory,
): DeckFilterDefinition {
  const record = expectRecord(value, "filterDefinition", errorFactory);
  expectOnlyAllowedKeys(record, ["version", "combineWith", "predicates"], "filterDefinition", errorFactory);

  if (record.version !== 1) {
    throwError(errorFactory, "filterDefinition version must be 1");
  }

  if (record.combineWith !== "and" && record.combineWith !== "or") {
    throwError(errorFactory, "filterDefinition combineWith must be 'and' or 'or'");
  }

  if (!Array.isArray(record.predicates)) {
    throwError(errorFactory, "filterDefinition predicates must be an array");
  }

  return {
    version: 1,
    combineWith: record.combineWith,
    predicates: record.predicates.map((predicate) => parseDeckPredicateWithFactory(predicate, errorFactory)),
  };
}

function mapDeck(row: DeckRow): Deck {
  return {
    deckId: row.deck_id,
    workspaceId: row.workspace_id,
    name: row.name,
    filterDefinition: parseDeckFilterDefinitionWithFactory(row.filter_definition, createStoredDataError),
    createdAt: toIsoString(row.created_at),
    serverVersion: toNumber(row.server_version),
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
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, server_version, client_updated_at,",
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
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, server_version, client_updated_at,",
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
        "deck_id, workspace_id, name, filter_definition, created_at, server_version, client_updated_at,",
        "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
        ")",
        "VALUES ($1, $2, $3, $4::jsonb, $5, DEFAULT, $6, $7, $8, now(), $9)",
        "RETURNING deck_id, workspace_id, name, filter_definition, created_at, server_version, client_updated_at,",
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

    return {
      deck: mapDeck(insertedRow),
      applied: true,
    };
  }

  const existingDeck = mapDeck(existingRow);
  if (incomingLwwMetadataWins(normalizedMetadata, toDeckLwwMetadata(existingDeck)) === false) {
    return {
      deck: existingDeck,
      applied: false,
    };
  }

  const updateResult = await executor.query<DeckRow>(
    [
      "UPDATE content.decks",
      "SET name = $1, filter_definition = $2::jsonb, created_at = $3, deleted_at = $4,",
      "client_updated_at = $5, last_modified_by_device_id = $6, last_operation_id = $7, updated_at = now(),",
      "server_version = nextval('content.decks_server_version_seq')",
      "WHERE workspace_id = $8 AND deck_id = $9",
      "RETURNING deck_id, workspace_id, name, filter_definition, created_at, server_version, client_updated_at,",
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

  return {
    deck: mapDeck(updatedRow),
    applied: true,
  };
}

export async function upsertDeckSnapshot(
  workspaceId: string,
  input: DeckSnapshotInput,
  metadata: DeckMutationMetadata,
): Promise<DeckMutationResult> {
  return transaction(async (executor) => upsertDeckSnapshotInExecutor(executor, workspaceId, input, metadata));
}

export async function listDeckChanges(
  workspaceId: string,
  afterServerVersion: number,
): Promise<ReadonlyArray<Deck>> {
  const result = await query<DeckRow>(
    [
      "SELECT deck_id, workspace_id, name, filter_definition, created_at, server_version, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND server_version > $2",
      "ORDER BY server_version ASC",
    ].join(" "),
    [workspaceId, afterServerVersion],
  );

  return result.rows.map(mapDeck);
}
