import { HttpError } from "../../shared/errors";
import type { BackendSyncConflictDetails } from "../../observability/sentry";

export function getSyncConflictLogContext(error: HttpError | unknown): BackendSyncConflictDetails {
  if (!(error instanceof HttpError)) {
    return emptySyncConflictDetails();
  }

  const syncConflict = error.details?.syncConflict;
  if (syncConflict === undefined) {
    return emptySyncConflictDetails();
  }

  return {
    syncConflictPhase: syncConflict.phase,
    syncConflictEntityType: syncConflict.entityType,
    syncConflictEntityId: syncConflict.entityId,
    conflictingWorkspaceId: syncConflict.conflictingWorkspaceId,
    constraint: syncConflict.constraint,
    sqlState: syncConflict.sqlState,
    table: syncConflict.table,
    entryIndex: syncConflict.entryIndex ?? null,
    reviewEventIndex: syncConflict.reviewEventIndex ?? null,
    syncConflictRecoverable: syncConflict.recoverable,
  };
}

export function emptySyncConflictDetails(): BackendSyncConflictDetails {
  return {
    syncConflictPhase: null,
    syncConflictEntityType: null,
    syncConflictEntityId: null,
    conflictingWorkspaceId: null,
    constraint: null,
    sqlState: null,
    table: null,
    entryIndex: null,
    reviewEventIndex: null,
    syncConflictRecoverable: null,
  };
}
