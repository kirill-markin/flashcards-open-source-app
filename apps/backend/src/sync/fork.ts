import { type DatabaseExecutor } from "../db";
import {
  HttpError,
  type HttpErrorDetails,
  type SyncConflictDetails,
  type SyncConflictEntityType,
} from "../errors";

export const SYNC_WORKSPACE_FORK_REQUIRED = "SYNC_WORKSPACE_FORK_REQUIRED";

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
