export type ValidationIssueSummary = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type SyncConflictEntityType = "card" | "deck" | "review_event";

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

export type HttpErrorDetails = Readonly<{
  validationIssues?: ReadonlyArray<ValidationIssueSummary>;
  syncConflict?: SyncConflictDetails;
}>;

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
