export type ValidationIssueSummary = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type SyncConflictEntityType = "card" | "deck" | "review_event" | "media_asset";

export type SyncConflictDetails = Readonly<{
  phase: string;
  entityType: SyncConflictEntityType;
  entityId: string;
  conflictingWorkspaceId: string;
  constraint: string | null;
  sqlState: string | null;
  table: string | null;
  entryIndex?: number;
  reviewEventIndex?: number;
  recoverable: true;
}>;

export type MediaAssetStorageErrorDetails = Readonly<{
  operation: string;
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  bucketName: string;
  s3StatusCode: number | null;
  s3ErrorClass: string;
  s3ErrorMessage: string;
}>;

export type HttpErrorDetails = Readonly<{
  validationIssues?: ReadonlyArray<ValidationIssueSummary>;
  syncConflict?: SyncConflictDetails;
  mediaAssetStorage?: MediaAssetStorageErrorDetails;
}>;

export type PublicSyncConflictDetails = Readonly<{
  phase: string;
  entityType: SyncConflictEntityType;
  entityId: string;
  entryIndex?: number;
  reviewEventIndex?: number;
  recoverable: true;
}>;

export type PublicHttpErrorDetails = Readonly<{
  validationIssues?: ReadonlyArray<ValidationIssueSummary>;
  syncConflict?: PublicSyncConflictDetails;
  mediaAssetStorage?: MediaAssetStorageErrorDetails;
}>;

function createPublicSyncConflictDetails(details: SyncConflictDetails): PublicSyncConflictDetails {
  return {
    phase: details.phase,
    entityType: details.entityType,
    entityId: details.entityId,
    ...(details.entryIndex === undefined ? {} : { entryIndex: details.entryIndex }),
    ...(details.reviewEventIndex === undefined ? {} : { reviewEventIndex: details.reviewEventIndex }),
    recoverable: details.recoverable,
  };
}

export function createPublicHttpErrorDetails(details: HttpErrorDetails | null): PublicHttpErrorDetails | null {
  if (details === null) {
    return null;
  }

  const validationIssues = details.validationIssues;
  const syncConflict = details.syncConflict;
  const mediaAssetStorage = details.mediaAssetStorage;
  if (validationIssues === undefined && syncConflict === undefined && mediaAssetStorage === undefined) {
    return null;
  }

  return {
    ...(validationIssues === undefined ? {} : { validationIssues }),
    ...(syncConflict === undefined ? {} : { syncConflict: createPublicSyncConflictDetails(syncConflict) }),
    ...(mediaAssetStorage === undefined ? {} : { mediaAssetStorage }),
  };
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly details: HttpErrorDetails | null;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: HttpErrorDetails,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? null;
    this.details = details ?? null;
  }
}
