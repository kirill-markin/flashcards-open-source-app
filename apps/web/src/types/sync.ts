import type { Card, Deck, FsrsCardState, ReviewEvent, ReviewRating, WorkspaceSchedulerSettings } from "./study";

export type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings" | "review_event";
export type SyncAction = "upsert" | "append";
export type LegacyEffortLevel = "fast" | "medium" | "long";

export type LegacyDeckFilterDefinition = Readonly<{
  version: 2;
  effortLevels: ReadonlyArray<LegacyEffortLevel>;
  tags: ReadonlyArray<string>;
}>;

export type SyncPushOperation =
  | Readonly<{
    operationId: string;
    entityType: "card";
    entityId: string;
    action: "upsert";
    clientUpdatedAt: string;
    payload: Readonly<{
      cardId: string;
      frontText: string;
      backText: string;
      tags: ReadonlyArray<string>;
      effortLevel: LegacyEffortLevel;
      dueAt: string | null;
      createdAt: string;
      reps: number;
      lapses: number;
      fsrsCardState: FsrsCardState;
      fsrsStepIndex: number | null;
      fsrsStability: number | null;
      fsrsDifficulty: number | null;
      fsrsLastReviewedAt: string | null;
      fsrsScheduledDays: number | null;
      deletedAt: string | null;
    }>;
  }>
  | Readonly<{
    operationId: string;
    entityType: "deck";
    entityId: string;
    action: "upsert";
    clientUpdatedAt: string;
    payload: Readonly<{
      deckId: string;
      name: string;
      filterDefinition: LegacyDeckFilterDefinition;
      createdAt: string;
      deletedAt: string | null;
    }>;
  }>
  | Readonly<{
    operationId: string;
    entityType: "workspace_scheduler_settings";
    entityId: string;
    action: "upsert";
    clientUpdatedAt: string;
    payload: Readonly<{
      algorithm: "fsrs-6";
      desiredRetention: number;
      learningStepsMinutes: ReadonlyArray<number>;
      relearningStepsMinutes: ReadonlyArray<number>;
      maximumIntervalDays: number;
      enableFuzz: boolean;
    }>;
  }>
  | Readonly<{
    operationId: string;
    entityType: "review_event";
    entityId: string;
    action: "append";
    clientUpdatedAt: string;
    payload: Readonly<{
      reviewEventId: string;
      cardId: string;
      clientEventId: string;
      rating: ReviewRating;
      reviewedAtClient: string;
      reviewedTimeZone?: string;
    }>;
  }>;

export type SyncPushResult = Readonly<{
  operations: ReadonlyArray<Readonly<{
    operationId: string;
    entityType: SyncEntityType;
    entityId: string;
    status: "applied" | "ignored" | "duplicate" | "rejected";
    resultingHotChangeId: number | null;
    error: string | null;
  }>>;
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

export type SyncChange = SyncBootstrapEntry & Readonly<{
  changeId: number;
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

export type SyncPullResult = Readonly<{
  changes: ReadonlyArray<SyncChange>;
  nextHotChangeId: number;
  hasMore: boolean;
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
