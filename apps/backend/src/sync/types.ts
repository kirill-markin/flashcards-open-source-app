import type {
  Card,
  ReviewEvent,
} from "../cards";
import type { Deck } from "../decks";
import type { WorkspaceSchedulerSettings } from "../workspaceSchedulerSettings";

export type TimestampValue = Date | string;

export type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings" | "review_event";
export type HotSyncEntityType = "card" | "deck" | "workspace_scheduler_settings";
export type SyncAction = "upsert" | "append";

export type WorkspaceSchedulerSettingsRow = Readonly<{
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: TimestampValue;
  fsrs_last_modified_by_replica_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: TimestampValue;
}>;

export type AppliedOperationRow = Readonly<{
  operation_id: string;
  resulting_hot_change_id: string | number | null;
}>;

export type HotChangeRow = Readonly<{
  change_id: string | number;
  entity_type: HotSyncEntityType;
  entity_id: string;
}>;

export type MaxChangeIdRow = Readonly<{
  max_change_id: string | number | null;
}>;

export type RemoteEmptyRow = Readonly<{
  has_cards: boolean;
  has_decks: boolean;
  has_review_events: boolean;
}>;

export type ReviewSequenceRow = Readonly<{
  review_sequence: string | number;
}>;

export type ReviewHistoryRow = Readonly<{
  review_event_id: string;
  workspace_id: string;
  replica_id: string;
  client_event_id: string;
  card_id: string;
  rating: number;
  reviewed_at_client: TimestampValue;
  reviewed_at_server: TimestampValue;
  review_sequence: string | number;
}>;

export type BootstrapProjectionRow = Readonly<{
  entity_rank: number;
  entity_type: HotSyncEntityType;
  entity_id: string;
  payload: unknown;
}>;

export type SyncBootstrapCursor = Readonly<{
  bootstrapHotChangeId: number;
  entityRank: number;
  entityId: string;
}>;

export type SyncBootstrapEntry =
  | Readonly<{
    entityType: "card";
    entityId: string;
    action: "upsert";
    payload: Card;
  }>
  | Readonly<{
    entityType: "deck";
    entityId: string;
    action: "upsert";
    payload: Deck;
  }>
  | Readonly<{
    entityType: "workspace_scheduler_settings";
    entityId: string;
    action: "upsert";
    payload: WorkspaceSchedulerSettings;
  }>;

export type SyncPushOperationResult = Readonly<{
  operationId: string;
  entityType: SyncEntityType;
  entityId: string;
  status: "applied" | "ignored" | "duplicate" | "rejected";
  resultingHotChangeId: number | null;
  error: string | null;
}>;

export type SyncPushResult = Readonly<{
  operations: ReadonlyArray<SyncPushOperationResult>;
}>;

export type SyncPullResult = Readonly<{
  changes: ReadonlyArray<Readonly<SyncBootstrapEntry & { changeId: number }>>;
  nextHotChangeId: number;
  hasMore: boolean;
}>;

export type SyncBootstrapPullResult = Readonly<{
  mode: "pull";
  entries: ReadonlyArray<SyncBootstrapEntry>;
  nextCursor: string | null;
  hasMore: boolean;
  bootstrapHotChangeId: number;
  remoteIsEmpty: boolean;
}>;

export type SyncBootstrapPushResult = Readonly<{
  mode: "push";
  appliedEntriesCount: number;
  bootstrapHotChangeId: number;
}>;

export type SyncReviewHistoryPullResult = Readonly<{
  reviewEvents: ReadonlyArray<ReviewEvent>;
  nextReviewSequenceId: number;
  hasMore: boolean;
}>;

export type SyncReviewHistoryImportResult = Readonly<{
  importedCount: number;
  duplicateCount: number;
  nextReviewSequenceId: number;
}>;
