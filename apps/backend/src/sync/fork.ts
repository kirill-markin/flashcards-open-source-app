import { createHash } from "node:crypto";
import { type DatabaseExecutor } from "../db";
import {
  HttpError,
  type HttpErrorDetails,
  type SyncConflictDetails,
  type SyncConflictEntityType,
} from "../errors";

export const SYNC_WORKSPACE_FORK_REQUIRED = "SYNC_WORKSPACE_FORK_REQUIRED";

const CARD_FORK_NAMESPACE = "5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1";
const DECK_FORK_NAMESPACE = "98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4";
const REVIEW_EVENT_FORK_NAMESPACE = "3a214a3e-9c89-426d-a21f-11a5f5c1d6e8";

type ConflictWorkspaceRow = Readonly<{
  workspace_id: string;
}>;

type SyncConflictLookupInput = Readonly<{
  entityType: SyncConflictEntityType;
  entityId: string;
}>;

type SyncConflictErrorInput = Readonly<{
  phase: string;
  entityType: SyncConflictEntityType;
  entityId: string;
  conflictingWorkspaceId: string;
  constraint: string | null;
  sqlState: string | null;
  table: string | null;
  entryIndex?: number;
  reviewEventIndex?: number;
}>;

type SyncConflictAnnotation = Readonly<{
  phase: string;
  entryIndex?: number;
  reviewEventIndex?: number;
}>;

function toUuidBytes(value: string): Buffer {
  const normalizedValue = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalizedValue)) {
    throw new Error(`Invalid UUID namespace: ${value}`);
  }

  return Buffer.from(normalizedValue, "hex");
}

function toUuidString(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function createDeterministicUuidV5(namespaceId: string, name: string): string {
  const hash = createHash("sha1");
  hash.update(toUuidBytes(namespaceId));
  hash.update(Buffer.from(name, "utf8"));
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return toUuidString(bytes);
}

function createForkName(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  entityId: string,
): string {
  return `${sourceWorkspaceId}:${targetWorkspaceId}:${entityId}`;
}

function createSyncConflictDetails(input: SyncConflictErrorInput): SyncConflictDetails {
  return {
    phase: input.phase,
    entityType: input.entityType,
    entityId: input.entityId,
    conflictingWorkspaceId: input.conflictingWorkspaceId,
    constraint: input.constraint,
    sqlState: input.sqlState,
    table: input.table,
    ...(input.entryIndex === undefined ? {} : { entryIndex: input.entryIndex }),
    ...(input.reviewEventIndex === undefined ? {} : { reviewEventIndex: input.reviewEventIndex }),
    recoverable: true,
  };
}

export async function findSyncConflictWorkspaceIdInExecutor(
  executor: DatabaseExecutor,
  input: SyncConflictLookupInput,
): Promise<string | null> {
  const result = await executor.query<ConflictWorkspaceRow>(
    "SELECT workspace_id FROM sync.find_conflicting_workspace_id($1, $2) LIMIT 1",
    [input.entityType, input.entityId],
  );

  return result.rows[0]?.workspace_id ?? null;
}

export function createSyncConflictHttpError(input: SyncConflictErrorInput): HttpError {
  return new HttpError(
    409,
    "Sync detected content copied from another workspace. Retry after forking ids.",
    SYNC_WORKSPACE_FORK_REQUIRED,
    {
      syncConflict: createSyncConflictDetails(input),
    },
  );
}

export function annotateSyncConflictHttpError(
  error: unknown,
  annotation: SyncConflictAnnotation,
): HttpError | null {
  if (!(error instanceof HttpError) || error.code !== SYNC_WORKSPACE_FORK_REQUIRED) {
    return null;
  }

  const syncConflict = error.details?.syncConflict;
  if (syncConflict === undefined) {
    return null;
  }

  const details: HttpErrorDetails = {
    ...error.details,
    syncConflict: {
      ...syncConflict,
      phase: annotation.phase,
      ...(annotation.entryIndex === undefined ? {} : { entryIndex: annotation.entryIndex }),
      ...(annotation.reviewEventIndex === undefined ? {} : { reviewEventIndex: annotation.reviewEventIndex }),
    },
  };

  return new HttpError(error.statusCode, error.message, error.code ?? undefined, details);
}

export function forkCardIdForWorkspace(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  cardId: string,
): string {
  if (sourceWorkspaceId === targetWorkspaceId) {
    return cardId;
  }

  return createDeterministicUuidV5(
    CARD_FORK_NAMESPACE,
    createForkName(sourceWorkspaceId, targetWorkspaceId, cardId),
  );
}

export function forkDeckIdForWorkspace(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  deckId: string,
): string {
  if (sourceWorkspaceId === targetWorkspaceId) {
    return deckId;
  }

  return createDeterministicUuidV5(
    DECK_FORK_NAMESPACE,
    createForkName(sourceWorkspaceId, targetWorkspaceId, deckId),
  );
}

export function forkReviewEventIdForWorkspace(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  reviewEventId: string,
): string {
  if (sourceWorkspaceId === targetWorkspaceId) {
    return reviewEventId;
  }

  return createDeterministicUuidV5(
    REVIEW_EVENT_FORK_NAMESPACE,
    createForkName(sourceWorkspaceId, targetWorkspaceId, reviewEventId),
  );
}
