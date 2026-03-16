import type { PersistedOutboxRecord } from "../localDb/outbox";
import type {
  LocalOutboxPagePayload,
  LocalToolCallRequest,
} from "./localToolExecutorTypes";

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

function parseToolInput(toolCallRequest: LocalToolCallRequest): unknown {
  try {
    return JSON.parse(toolCallRequest.input) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool ${toolCallRequest.name} input is invalid JSON: ${message}`);
  }
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

function getNextCursorForPage(totalCount: number, startIndex: number, visibleCount: number): string | null {
  const nextIndex = startIndex + visibleCount;
  if (nextIndex >= totalCount) {
    return null;
  }

  return encodePageCursor(nextIndex);
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

export function normalizeLimit(limit: number): number {
  if (limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }

  return limit;
}

export function parseEmptyObjectInput(toolCallRequest: LocalToolCallRequest): void {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, [], toolCallRequest.name);
}

export function parseSqlInput(toolCallRequest: LocalToolCallRequest): Readonly<{ sql: string }> {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["sql"], toolCallRequest.name);
  return {
    sql: expectString(body.sql, `${toolCallRequest.name}.sql`).trim(),
  };
}

export function parseListOutboxInput(
  toolCallRequest: LocalToolCallRequest,
): Readonly<{ cursor: string | null; limit: number }> {
  const body = expectRecord(parseToolInput(toolCallRequest), toolCallRequest.name);
  expectNoExtraKeys(body, ["cursor", "limit"], toolCallRequest.name);
  return {
    cursor: expectNullableString(body.cursor, `${toolCallRequest.name}.cursor`),
    limit: expectInteger(body.limit, `${toolCallRequest.name}.limit`),
  };
}

export function getPageStartIndex(cursor: string | null): number {
  if (cursor === null) {
    return 0;
  }

  return decodePageCursor(cursor);
}

export function makeOutboxPayload(
  outbox: ReadonlyArray<PersistedOutboxRecord>,
  workspaceId: string,
  startIndex: number,
  limit: number,
): LocalOutboxPagePayload {
  const workspaceEntries = outbox.filter((entry) => entry.workspaceId === workspaceId);
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
