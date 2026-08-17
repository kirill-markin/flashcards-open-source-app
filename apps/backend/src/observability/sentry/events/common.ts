import type { BackendFailureDetails } from "../../failureDetails";

export type BackendService =
  | "backend-api"
  | "chat-worker"
  | "chat-live"
  | "global-metrics-snapshot"
  | "community-leaderboard-snapshot"
  | "streak-leaderboard-snapshot"
  | "progress-active-days-backfill"
  | "generated-media-promotion"
  | "multipart-completion-reconciliation"
  | "migration";

export type BackendObservationScope = Readonly<{
  service: BackendService;
  requestId: string | null;
  route: string | null;
  method: string | null;
  userId: string | null;
  workspaceId: string | null;
  chatRequestId: string | null;
  runId: string | null;
  sessionId: string | null;
  clientAppVersion: string | null;
  clientPlatform: string | null;
}>;

export type BackendTraceCarrier = Readonly<{
  sentryTrace: string | null;
  baggage: string | null;
}>;

export type BackendErrorLogDetails = Readonly<{
  errorClass: string;
  errorMessage: string;
  errorStack: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
}>;

export type RequestErrorDetails = BackendFailureDetails & BackendErrorLogDetails & Readonly<{
  sqlState: string | null;
}>;

export type BackendDatabaseDetails = Readonly<{
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  detail: string | null;
}>;

export type BackendSyncConflictDetails = Readonly<{
  syncConflictPhase: string | null;
  syncConflictEntityType: "card" | "deck" | "review_event" | "media_asset" | null;
  syncConflictEntityId: string | null;
  conflictingWorkspaceId: string | null;
  constraint: string | null;
  sqlState: string | null;
  table: string | null;
  entryIndex: number | null;
  reviewEventIndex: number | null;
  syncConflictRecoverable: boolean | null;
}>;

export type EmptyDetails = Readonly<{
  ok: true;
}>;

export type EventByAction<Action extends string, Details> = Readonly<{
  action: Action;
  scope: BackendObservationScope;
  details: Details;
}>;

export type FailureDetailsFor<Details> = Details & BackendFailureDetails;
export type SyncConflictFailureDetailsFor<Details> =
  FailureDetailsFor<Details> & BackendSyncConflictDetails;

export type CommonBreadcrumbEvent =
  EventByAction<"request_error", RequestErrorDetails>;

export type CommonExceptionEvent =
  (EventByAction<"request_failed", BackendFailureDetails> & Readonly<{ error: Error }>);
