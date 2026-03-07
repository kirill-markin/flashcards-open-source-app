import { randomUUID } from "node:crypto";
import { query } from "./db";
import { HttpError } from "./errors";
import type { EffortLevel } from "./cards";

type TimestampValue = Date | string;
type ErrorFactory = (message: string) => Error;

type DeckRow = Readonly<{
  deck_id: string;
  name: string;
  filter_definition: unknown;
  created_at: TimestampValue;
  updated_at: TimestampValue;
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
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
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
    name: row.name,
    filterDefinition: parseDeckFilterDefinitionWithFactory(row.filter_definition, createStoredDataError),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
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
      "SELECT deck_id, name, filter_definition, created_at, updated_at",
      "FROM content.decks",
      "WHERE workspace_id = $1",
      "ORDER BY updated_at DESC, created_at DESC",
    ].join(" "),
    [workspaceId],
  );

  return result.rows.map(mapDeck);
}

export async function createDeck(workspaceId: string, input: CreateDeckInput): Promise<Deck> {
  const result = await query<DeckRow>(
    [
      "INSERT INTO content.decks",
      "(deck_id, workspace_id, name, filter_definition)",
      "VALUES ($1, $2, $3, $4::jsonb)",
      "RETURNING deck_id, name, filter_definition, created_at, updated_at",
    ].join(" "),
    [randomUUID(), workspaceId, input.name, JSON.stringify(input.filterDefinition)],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Deck insert did not return a row");
  }

  return mapDeck(row);
}
