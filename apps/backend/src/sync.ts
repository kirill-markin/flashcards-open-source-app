import { z } from "zod";
import {
  appendReviewEventSnapshotInExecutor,
  upsertCardSnapshotInExecutor,
  type Card,
  type ReviewEvent,
} from "./cards";
import type { CardRow } from "./cards/types";
import { mapCard } from "./cards/shared";
import {
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "./db";
import {
  ensureSyncDevice,
  type SyncDevicePlatform,
} from "./devices";
import {
  mapDeck,
  upsertDeckSnapshotInExecutor,
  type Deck,
  type DeckRow,
} from "./decks";
import { HttpError } from "./errors";
import { normalizeIsoTimestamp } from "./lww";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
} from "./pagination";
import {
  applyWorkspaceSchedulerSettingsSnapshotInExecutor,
  type WorkspaceSchedulerSettings,
} from "./workspaceSchedulerSettings";
import type { HttpErrorDetails, ValidationIssueSummary } from "./errors";
import {
  ensureWorkspaceSyncMetadataInExecutor,
  findLatestSyncChangeId,
  insertSyncChange,
  loadMinAvailableHotChangeId,
} from "./syncChanges";

type TimestampValue = Date | string;

type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings" | "review_event";
type HotSyncEntityType = "card" | "deck" | "workspace_scheduler_settings";
type SyncAction = "upsert" | "append";

type Platform = "ios" | "android" | "web";

type WorkspaceSchedulerSettingsRow = Readonly<{
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: TimestampValue;
  fsrs_last_modified_by_device_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: TimestampValue;
}>;

type AppliedOperationRow = Readonly<{
  operation_id: string;
  resulting_hot_change_id: string | number | null;
}>;

type HotChangeRow = Readonly<{
  change_id: string | number;
  entity_type: HotSyncEntityType;
  entity_id: string;
}>;

type MaxChangeIdRow = Readonly<{
  max_change_id: string | number | null;
}>;

type RemoteEmptyRow = Readonly<{
  has_cards: boolean;
  has_decks: boolean;
  has_review_events: boolean;
}>;

type ReviewSequenceRow = Readonly<{
  review_sequence: string | number;
}>;

type ReviewHistoryRow = Readonly<{
  review_event_id: string;
  workspace_id: string;
  device_id: string;
  client_event_id: string;
  card_id: string;
  rating: number;
  reviewed_at_client: TimestampValue;
  reviewed_at_server: TimestampValue;
  review_sequence: string | number;
}>;

type BootstrapProjectionRow = Readonly<{
  entity_rank: number;
  entity_type: HotSyncEntityType;
  entity_id: string;
  payload: unknown;
}>;

const effortLevelSchema = z.enum(["fast", "medium", "long"]);
const fsrsCardStateSchema = z.enum(["new", "learning", "review", "relearning"]);
const reviewRatingSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const platformSchema = z.enum(["ios", "android", "web"]);

const deckFilterDefinitionSchema = z.object({
  version: z.literal(2),
  effortLevels: z.array(effortLevelSchema),
  tags: z.array(z.string()),
});

const cardSnapshotSchema = z.object({
  cardId: z.string().min(1),
  frontText: z.string().min(1),
  backText: z.string(),
  tags: z.array(z.string()),
  effortLevel: effortLevelSchema,
  dueAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  fsrsCardState: fsrsCardStateSchema,
  fsrsStepIndex: z.number().int().nonnegative().nullable(),
  fsrsStability: z.number().finite().nullable(),
  fsrsDifficulty: z.number().finite().nullable(),
  fsrsLastReviewedAt: z.string().datetime().nullable(),
  fsrsScheduledDays: z.number().int().nonnegative().nullable(),
  deletedAt: z.string().datetime().nullable(),
});

const cardPayloadSchema = cardSnapshotSchema.extend({
  clientUpdatedAt: z.string().datetime(),
  lastModifiedByDeviceId: z.string().min(1),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
});

const deckSnapshotSchema = z.object({
  deckId: z.string().min(1),
  name: z.string().min(1),
  filterDefinition: deckFilterDefinitionSchema,
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

const deckPayloadSchema = deckSnapshotSchema.extend({
  workspaceId: z.string().min(1),
  clientUpdatedAt: z.string().datetime(),
  lastModifiedByDeviceId: z.string().min(1),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
});

const workspaceSchedulerSettingsSnapshotSchema = z.object({
  algorithm: z.literal("fsrs-6"),
  desiredRetention: z.number().gt(0).lt(1),
  learningStepsMinutes: z.array(z.number().int().positive()).min(1),
  relearningStepsMinutes: z.array(z.number().int().positive()).min(1),
  maximumIntervalDays: z.number().int().positive(),
  enableFuzz: z.boolean(),
});

const workspaceSchedulerSettingsPayloadSchema = workspaceSchedulerSettingsSnapshotSchema.extend({
  clientUpdatedAt: z.string().datetime(),
  lastModifiedByDeviceId: z.string().min(1),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
});

const reviewEventPushPayloadSchema = z.object({
  reviewEventId: z.string().min(1),
  cardId: z.string().min(1),
  deviceId: z.string().min(1),
  clientEventId: z.string().min(1),
  rating: reviewRatingSchema,
  reviewedAtClient: z.string().datetime(),
});

const reviewEventPayloadSchema = reviewEventPushPayloadSchema.extend({
  workspaceId: z.string().min(1),
  reviewedAtServer: z.string().datetime(),
});

const baseOperationSchema = z.object({
  operationId: z.string().min(1),
  entityId: z.string().min(1),
  clientUpdatedAt: z.string().datetime(),
});

const cardOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("card"),
  action: z.literal("upsert"),
  payload: cardSnapshotSchema,
});

const deckOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("deck"),
  action: z.literal("upsert"),
  payload: deckSnapshotSchema,
});

const workspaceSchedulerSettingsOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("workspace_scheduler_settings"),
  action: z.literal("upsert"),
  payload: workspaceSchedulerSettingsSnapshotSchema,
});

const reviewEventOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("review_event"),
  action: z.literal("append"),
  payload: reviewEventPushPayloadSchema,
});

/**
 * Validates `/sync/push` requests from iOS/web clients.
 *
 * Keep this schema aligned with the request builders in
 * `apps/ios/Flashcards/Flashcards/CloudSyncService.swift` and the parser tests in
 * `apps/backend/src/sync.test.ts`.
 */
const syncPushInputSchema = z.object({
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  operations: z.array(
    z.discriminatedUnion("entityType", [
      cardOperationSchema,
      deckOperationSchema,
      workspaceSchedulerSettingsOperationSchema,
      reviewEventOperationSchema,
    ]),
  ),
});

/**
 * Validates `/sync/pull` requests for the hot mutable state lane.
 *
 * The matching iOS sender and decoder live in
 * `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
 */
const syncPullInputSchema = z.object({
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  afterHotChangeId: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
});

/**
 * Bootstrap pull requires an explicit nullable `cursor` key on every page.
 *
 * The iOS sender in `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`
 * intentionally serializes `"cursor": null` on the first page instead of
 * omitting the key. Keep this validator aligned with:
 * - `apps/ios/Flashcards/Flashcards/CloudSyncService.swift` `BootstrapPullRequest`
 * - `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`
 */
const syncBootstrapPullInputSchema = z.object({
  mode: z.literal("pull"),
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  cursor: z.string().min(1).nullable(),
  limit: z.number().int().positive().max(500),
});

/**
 * Validates `/sync/bootstrap` push requests used only for empty-remote
 * bootstrap. This shape must stay aligned with the iOS empty-remote bootstrap
 * sender in `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
 */
const syncBootstrapPushInputSchema = z.object({
  mode: z.literal("push"),
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  entries: z.array(
    z.discriminatedUnion("entityType", [
      z.object({
        entityType: z.literal("card"),
        entityId: z.string().min(1),
        action: z.literal("upsert"),
        payload: cardPayloadSchema,
      }),
      z.object({
        entityType: z.literal("deck"),
        entityId: z.string().min(1),
        action: z.literal("upsert"),
        payload: deckPayloadSchema,
      }),
      z.object({
        entityType: z.literal("workspace_scheduler_settings"),
        entityId: z.string().min(1),
        action: z.literal("upsert"),
        payload: workspaceSchedulerSettingsPayloadSchema,
      }),
    ]),
  ),
});

/**
 * Validates `/sync/review-history/pull` requests for the append-only history
 * lane. Keep this schema aligned with the dedicated review-history sender in
 * `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
 */
const syncReviewHistoryPullInputSchema = z.object({
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  afterReviewSequenceId: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
});

/**
 * Validates `/sync/review-history/import` requests used by empty-remote
 * bootstrap. Keep this schema aligned with the import sender in
 * `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
 */
const syncReviewHistoryImportInputSchema = z.object({
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  reviewEvents: z.array(reviewEventPayloadSchema),
});

type SyncBootstrapCursor = Readonly<{
  bootstrapHotChangeId: number;
  entityRank: number;
  entityId: string;
}>;

export type SyncPushInput = z.infer<typeof syncPushInputSchema>;
export type SyncPullInput = z.infer<typeof syncPullInputSchema>;
export type SyncBootstrapInput =
  | z.infer<typeof syncBootstrapPullInputSchema>
  | z.infer<typeof syncBootstrapPushInputSchema>;
export type SyncReviewHistoryPullInput = z.infer<typeof syncReviewHistoryPullInputSchema>;
export type SyncReviewHistoryImportInput = z.infer<typeof syncReviewHistoryImportInputSchema>;
export type SyncPushOperation = SyncPushInput["operations"][number];

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
  entityType: SyncPushOperation["entityType"];
  entityId: string;
  status: "applied" | "ignored" | "duplicate" | "rejected";
  resultingHotChangeId: number | null;
  error: string | null;
}>;

/**
 * Response shape returned by `/sync/push`.
 *
 * Keep this result aligned with the decoders in
 * `apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift` and the request/response
 * handling in `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
 */
export type SyncPushResult = Readonly<{
  operations: ReadonlyArray<SyncPushOperationResult>;
}>;

/** Response shape returned by `/sync/pull` for hot mutable state only. */
export type SyncPullResult = Readonly<{
  changes: ReadonlyArray<Readonly<SyncBootstrapEntry & { changeId: number }>>;
  nextHotChangeId: number;
  hasMore: boolean;
}>;

/** Response shape returned by `/sync/bootstrap` in pull mode. */
export type SyncBootstrapPullResult = Readonly<{
  mode: "pull";
  entries: ReadonlyArray<SyncBootstrapEntry>;
  nextCursor: string | null;
  hasMore: boolean;
  bootstrapHotChangeId: number;
  remoteIsEmpty: boolean;
}>;

/** Response shape returned by `/sync/bootstrap` in push mode. */
export type SyncBootstrapPushResult = Readonly<{
  mode: "push";
  appliedEntriesCount: number;
  bootstrapHotChangeId: number;
}>;

/** Response shape returned by `/sync/review-history/pull`. */
export type SyncReviewHistoryPullResult = Readonly<{
  reviewEvents: ReadonlyArray<ReviewEvent>;
  nextReviewSequenceId: number;
  hasMore: boolean;
}>;

/** Response shape returned by `/sync/review-history/import`. */
export type SyncReviewHistoryImportResult = Readonly<{
  importedCount: number;
  duplicateCount: number;
  nextReviewSequenceId: number;
}>;

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toIsoString(value: TimestampValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summarizeValidationIssue(issue: z.core.$ZodIssue): ValidationIssueSummary {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";

  return {
    path,
    code: issue.code,
    message: issue.message,
  };
}

function summarizeValidationDetails(error: z.ZodError): HttpErrorDetails {
  return {
    validationIssues: error.issues.map(summarizeValidationIssue),
  };
}

function parseOrThrow<ParsedType>(schema: z.ZodSchema<ParsedType>, value: unknown): ParsedType {
  const parsedInput = schema.safeParse(value);
  if (parsedInput.success) {
    return parsedInput.data;
  }

  throw new HttpError(
    400,
    "Cloud sync failed. Try again.",
    "SYNC_INVALID_INPUT",
    summarizeValidationDetails(parsedInput.error),
  );
}

function toWorkspaceSchedulerSettings(row: WorkspaceSchedulerSettingsRow): WorkspaceSchedulerSettings {
  if (row.fsrs_algorithm !== "fsrs-6") {
    throw new Error(`Unsupported scheduler algorithm: ${row.fsrs_algorithm}`);
  }

  return {
    algorithm: row.fsrs_algorithm,
    desiredRetention: row.fsrs_desired_retention,
    learningStepsMinutes: [...row.fsrs_learning_steps_minutes],
    relearningStepsMinutes: [...row.fsrs_relearning_steps_minutes],
    maximumIntervalDays: row.fsrs_maximum_interval_days,
    enableFuzz: row.fsrs_enable_fuzz,
    clientUpdatedAt: toIsoString(row.fsrs_client_updated_at),
    lastModifiedByDeviceId: row.fsrs_last_modified_by_device_id,
    lastOperationId: row.fsrs_last_operation_id,
    updatedAt: toIsoString(row.fsrs_updated_at),
  };
}

function encodeBootstrapCursor(cursor: SyncBootstrapCursor): string {
  return encodeOpaqueCursor([
    cursor.bootstrapHotChangeId,
    cursor.entityRank,
    cursor.entityId,
  ]);
}

function decodeBootstrapCursor(cursor: string): SyncBootstrapCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 3) {
    throw new HttpError(400, "cursor is invalid");
  }

  const bootstrapHotChangeId = decodedCursor.values[0];
  const entityRank = decodedCursor.values[1];
  const entityId = decodedCursor.values[2];
  if (typeof bootstrapHotChangeId !== "number" || typeof entityRank !== "number" || typeof entityId !== "string") {
    throw new HttpError(400, "cursor is invalid");
  }

  return {
    bootstrapHotChangeId,
    entityRank,
    entityId,
  };
}

async function loadWorkspaceSchedulerSettingsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<WorkspaceSchedulerSettings> {
  const result = await executor.query<WorkspaceSchedulerSettingsRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
      "LIMIT 1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Workspace scheduler settings row is missing");
  }

  return toWorkspaceSchedulerSettings(row);
}

async function loadCardsByIdsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Card>> {
  if (cardIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<CardRow>(
    [
      "SELECT",
      "card_id, front_text, back_text, tags, effort_level, due_at, created_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND card_id = ANY($2::uuid[])",
    ].join(" "),
    [workspaceId, [...cardIds]],
  );

  return new Map(result.rows.map((row) => [row.card_id, mapCard(row)]));
}

async function loadDecksByIdsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deckIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Deck>> {
  if (deckIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<DeckRow>(
    [
      "SELECT",
      "deck_id, workspace_id, name, filter_definition, created_at, client_updated_at, last_modified_by_device_id,",
      "last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = ANY($2::uuid[])",
    ].join(" "),
    [workspaceId, [...deckIds]],
  );

  return new Map(result.rows.map((row) => [row.deck_id, mapDeck(row)]));
}

async function loadExistingAppliedOperations(
  executor: DatabaseExecutor,
  workspaceId: string,
  deviceId: string,
  operationIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, number | null>> {
  if (operationIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<AppliedOperationRow>(
    [
      "SELECT DISTINCT ON (operation_id) operation_id, resulting_hot_change_id",
      "FROM sync.applied_operations_current",
      "WHERE workspace_id = $1 AND device_id = $2 AND operation_id = ANY($3::text[])",
      "ORDER BY operation_id ASC, applied_at DESC",
    ].join(" "),
    [workspaceId, deviceId, [...operationIds]],
  );

  return new Map(result.rows.map((row) => [row.operation_id, toNumber(row.resulting_hot_change_id)]));
}

async function loadCurrentMaxHotChangeId(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<MaxChangeIdRow>(
    [
      "SELECT COALESCE(MAX(change_id), 0) AS max_change_id",
      "FROM sync.hot_changes",
      "WHERE workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to load current hot change id");
  }

  return toNumber(row.max_change_id) ?? 0;
}

async function loadCurrentReviewSequenceId(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<Readonly<{ max_review_sequence: string | number | null }>>(
    [
      "SELECT COALESCE(MAX(review_sequence), 0) AS max_review_sequence",
      "FROM content.review_events",
      "WHERE workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to load current review sequence id");
  }

  return toNumber(row.max_review_sequence) ?? 0;
}

async function loadRemoteEmptyState(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<boolean> {
  const result = await executor.query<RemoteEmptyRow>(
    [
      "SELECT",
      "EXISTS (SELECT 1 FROM content.cards WHERE workspace_id = $1) AS has_cards,",
      "EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = $1) AS has_decks,",
      "EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = $1) AS has_review_events",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to determine remote bootstrap state");
  }

  return row.has_cards === false && row.has_decks === false && row.has_review_events === false;
}

function parseBootstrapEntryRow(row: BootstrapProjectionRow): SyncBootstrapEntry {
  if (row.entity_type === "card") {
    return {
      entityType: "card",
      entityId: row.entity_id,
      action: "upsert",
      payload: cardPayloadSchema.parse(row.payload),
    };
  }

  if (row.entity_type === "deck") {
    return {
      entityType: "deck",
      entityId: row.entity_id,
      action: "upsert",
      payload: deckPayloadSchema.parse(row.payload),
    };
  }

  return {
    entityType: "workspace_scheduler_settings",
    entityId: row.entity_id,
    action: "upsert",
    payload: workspaceSchedulerSettingsPayloadSchema.parse(row.payload),
  };
}

async function processOperationInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deviceId: string,
  operation: SyncPushOperation,
): Promise<SyncPushOperationResult> {
  let resultingHotChangeId: number | null = null;
  let status: SyncPushOperationResult["status"] = "applied";

  if (operation.entityType === "card") {
    if (operation.entityId !== operation.payload.cardId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "card entityId must match payload.cardId",
      };
    }

    const mutation = await upsertCardSnapshotInExecutor(
      executor,
      workspaceId,
      operation.payload,
      {
        clientUpdatedAt: operation.clientUpdatedAt,
        lastModifiedByDeviceId: deviceId,
        lastOperationId: operation.operationId,
      },
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = mutation.changeId;
  } else if (operation.entityType === "deck") {
    if (operation.entityId !== operation.payload.deckId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "deck entityId must match payload.deckId",
      };
    }

    const mutation = await upsertDeckSnapshotInExecutor(
      executor,
      workspaceId,
      operation.payload,
      {
        clientUpdatedAt: operation.clientUpdatedAt,
        lastModifiedByDeviceId: deviceId,
        lastOperationId: operation.operationId,
      },
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = mutation.changeId;
  } else if (operation.entityType === "workspace_scheduler_settings") {
    if (operation.entityId !== workspaceId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "workspace_scheduler_settings entityId must match the authenticated workspaceId",
      };
    }

    const mutation = await applyWorkspaceSchedulerSettingsSnapshotInExecutor(
      executor,
      workspaceId,
      operation.payload,
      {
        clientUpdatedAt: operation.clientUpdatedAt,
        lastModifiedByDeviceId: deviceId,
        lastOperationId: operation.operationId,
      },
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = mutation.changeId;
  } else {
    if (operation.entityId !== operation.payload.reviewEventId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event entityId must match payload.reviewEventId",
      };
    }

    if (operation.payload.deviceId !== deviceId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event payload.deviceId must match the authenticated sync deviceId",
      };
    }

    const normalizedClientUpdatedAt = normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt");
    const normalizedReviewedAtClient = normalizeIsoTimestamp(operation.payload.reviewedAtClient, "reviewedAtClient");
    if (normalizedClientUpdatedAt !== normalizedReviewedAtClient) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event clientUpdatedAt must match reviewedAtClient",
      };
    }

    const cardExistsResult = await executor.query<Readonly<{ card_id: string }>>(
      [
        "SELECT card_id",
        "FROM content.cards",
        "WHERE workspace_id = $1 AND card_id = $2",
        "LIMIT 1",
      ].join(" "),
      [workspaceId, operation.payload.cardId],
    );
    if (cardExistsResult.rows[0] === undefined) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event payload.cardId must reference an existing card",
      };
    }

    const mutation = await appendReviewEventSnapshotInExecutor(
      executor,
      workspaceId,
      {
        reviewEventId: operation.payload.reviewEventId,
        workspaceId,
        cardId: operation.payload.cardId,
        deviceId,
        clientEventId: operation.payload.clientEventId,
        rating: operation.payload.rating,
        reviewedAtClient: normalizedReviewedAtClient,
        reviewedAtServer: new Date().toISOString(),
      },
      operation.operationId,
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = null;
  }

  await executor.query(
    [
      "INSERT INTO sync.applied_operations_current",
      "(",
      "workspace_id, device_id, operation_id, operation_type, entity_type, entity_id, client_updated_at, resulting_hot_change_id, applied_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())",
    ].join(" "),
    [
      workspaceId,
      deviceId,
      operation.operationId,
      operation.action,
      operation.entityType,
      operation.entityId,
      normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt"),
      resultingHotChangeId,
    ],
  );

  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status,
    resultingHotChangeId,
    error: null,
  };
}

async function buildHotChangesFromRows(
  executor: DatabaseExecutor,
  workspaceId: string,
  rows: ReadonlyArray<HotChangeRow>,
): Promise<ReadonlyArray<Readonly<SyncBootstrapEntry & { changeId: number }>>> {
  const cardIds = rows.filter((row) => row.entity_type === "card").map((row) => row.entity_id);
  const deckIds = rows.filter((row) => row.entity_type === "deck").map((row) => row.entity_id);
  const workspaceSettingsNeeded = rows.some((row) => row.entity_type === "workspace_scheduler_settings");

  const [cardsById, decksById, workspaceSchedulerSettings] = await Promise.all([
    loadCardsByIdsInExecutor(executor, workspaceId, cardIds),
    loadDecksByIdsInExecutor(executor, workspaceId, deckIds),
    workspaceSettingsNeeded ? loadWorkspaceSchedulerSettingsInExecutor(executor, workspaceId) : Promise.resolve(null),
  ]);

  return rows.map((row) => {
    const changeId = toNumber(row.change_id);
    if (changeId === null) {
      throw new Error("Hot change id must not be NULL");
    }

    if (row.entity_type === "card") {
      const card = cardsById.get(row.entity_id);
      if (card === undefined) {
        throw new Error(`Hot sync card ${row.entity_id} is missing`);
      }

      return {
        changeId,
        entityType: "card" as const,
        entityId: row.entity_id,
        action: "upsert" as const,
        payload: card,
      };
    }

    if (row.entity_type === "deck") {
      const deck = decksById.get(row.entity_id);
      if (deck === undefined) {
        throw new Error(`Hot sync deck ${row.entity_id} is missing`);
      }

      return {
        changeId,
        entityType: "deck" as const,
        entityId: row.entity_id,
        action: "upsert" as const,
        payload: deck,
      };
    }

    if (workspaceSchedulerSettings === null) {
      throw new Error("Hot sync workspace scheduler settings row is missing");
    }

    return {
      changeId,
      entityType: "workspace_scheduler_settings" as const,
      entityId: row.entity_id,
      action: "upsert" as const,
      payload: workspaceSchedulerSettings,
    };
  });
}

export function parseSyncPushInput(value: unknown): SyncPushInput {
  return parseOrThrow(syncPushInputSchema, value);
}

export function parseSyncPullInput(value: unknown): SyncPullInput {
  return parseOrThrow(syncPullInputSchema, value);
}

export function parseSyncBootstrapInput(value: unknown): SyncBootstrapInput {
  /**
   * Keep bootstrap mode dispatch in sync with the client-side request builders in
   * `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`. If you change how
   * pull requests are detected here, update the iOS sender and
   * `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift` together.
   */
  const record = typeof value === "object" && value !== null && Array.isArray(value) === false
    ? value as Record<string, unknown>
    : null;
  if (record === null || typeof record.mode !== "string") {
    throw new HttpError(400, "Cloud sync failed. Try again.", "SYNC_INVALID_INPUT");
  }

  if (record.mode === "pull") {
    return parseOrThrow(syncBootstrapPullInputSchema, value);
  }

  if (record.mode === "push") {
    return parseOrThrow(syncBootstrapPushInputSchema, value);
  }

  throw new HttpError(400, "Cloud sync failed. Try again.", "SYNC_INVALID_INPUT");
}

export function parseSyncReviewHistoryPullInput(value: unknown): SyncReviewHistoryPullInput {
  return parseOrThrow(syncReviewHistoryPullInputSchema, value);
}

export function parseSyncReviewHistoryImportInput(value: unknown): SyncReviewHistoryImportInput {
  return parseOrThrow(syncReviewHistoryImportInputSchema, value);
}

/**
 * Applies a batch of outbox operations inside one workspace-scoped database
 * transaction so sync/push no longer pays one BEGIN/COMMIT round-trip per
 * operation.
 */
export async function processSyncPush(
  workspaceId: string,
  userId: string,
  input: SyncPushInput,
): Promise<SyncPushResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  const operationResults = await transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
      const existingAppliedOperations = await loadExistingAppliedOperations(
        executor,
        workspaceId,
        input.deviceId,
        input.operations.map((operation) => operation.operationId),
      );
      const results: Array<SyncPushOperationResult> = [];

      for (const operation of input.operations) {
        const existingResultingHotChangeId = existingAppliedOperations.get(operation.operationId);
        if (existingAppliedOperations.has(operation.operationId)) {
          results.push({
            operationId: operation.operationId,
            entityType: operation.entityType,
            entityId: operation.entityId,
            status: "duplicate",
            resultingHotChangeId: existingResultingHotChangeId ?? null,
            error: null,
          });
          continue;
        }

        results.push(await processOperationInExecutor(executor, workspaceId, input.deviceId, operation));
      }

      return results;
    },
  );

  return {
    operations: operationResults,
  };
}

/**
 * Reads only the hot mutable-state change lane. Review history is excluded
 * from this endpoint and syncs through its own append-only cursor.
 */
export async function processSyncPull(
  workspaceId: string,
  userId: string,
  input: SyncPullInput,
): Promise<SyncPullResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
    const minAvailableHotChangeId = await loadMinAvailableHotChangeId(executor, workspaceId);
    if (input.afterHotChangeId > 0 && input.afterHotChangeId < minAvailableHotChangeId) {
      throw new HttpError(
        409,
        "Cloud sync requires a fresh bootstrap.",
        "SYNC_BOOTSTRAP_REQUIRED",
      );
    }

    const result = await executor.query<HotChangeRow>(
      [
        "WITH latest_changes AS (",
        "  SELECT DISTINCT ON (entity_type, entity_id)",
        "    change_id, entity_type, entity_id",
        "  FROM sync.hot_changes",
        "  WHERE workspace_id = $1 AND change_id > $2",
        "  ORDER BY entity_type ASC, entity_id ASC, change_id DESC",
        ")",
        "SELECT change_id, entity_type, entity_id",
        "FROM latest_changes",
        "ORDER BY change_id ASC",
        "LIMIT $3",
      ].join(" "),
      [workspaceId, input.afterHotChangeId, input.limit + 1],
    );

    const hasMore = result.rows.length > input.limit;
    const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
    const changes = await buildHotChangesFromRows(executor, workspaceId, visibleRows);
    const nextHotChangeId = changes.length === 0
      ? input.afterHotChangeId
      : changes[changes.length - 1].changeId;

    return {
      changes,
      nextHotChangeId,
      hasMore,
    };
  });
}

/**
 * Handles both directions of the blocking hot bootstrap. Clients either pull
 * current mutable state from canonical tables or upload their local current
 * state into an empty remote workspace.
 */
export async function processSyncBootstrap(
  workspaceId: string,
  userId: string,
  input: SyncBootstrapInput,
): Promise<SyncBootstrapPullResult | SyncBootstrapPushResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  if (input.mode === "push") {
    return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
      await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
      const remoteIsEmpty = await loadRemoteEmptyState(executor, workspaceId);
      if (remoteIsEmpty === false) {
        throw new HttpError(409, "Cloud bootstrap requires an empty remote workspace", "SYNC_BOOTSTRAP_NOT_EMPTY");
      }

      let appliedEntriesCount = 0;
      for (const entry of input.entries) {
        if (entry.entityType === "card") {
          await upsertCardSnapshotInExecutor(
            executor,
            workspaceId,
            {
              cardId: entry.payload.cardId,
              frontText: entry.payload.frontText,
              backText: entry.payload.backText,
              tags: entry.payload.tags,
              effortLevel: entry.payload.effortLevel,
              dueAt: entry.payload.dueAt,
              createdAt: entry.payload.createdAt,
              reps: entry.payload.reps,
              lapses: entry.payload.lapses,
              fsrsCardState: entry.payload.fsrsCardState,
              fsrsStepIndex: entry.payload.fsrsStepIndex,
              fsrsStability: entry.payload.fsrsStability,
              fsrsDifficulty: entry.payload.fsrsDifficulty,
              fsrsLastReviewedAt: entry.payload.fsrsLastReviewedAt,
              fsrsScheduledDays: entry.payload.fsrsScheduledDays,
              deletedAt: entry.payload.deletedAt,
            },
            {
              clientUpdatedAt: entry.payload.clientUpdatedAt,
              lastModifiedByDeviceId: entry.payload.lastModifiedByDeviceId,
              lastOperationId: entry.payload.lastOperationId,
            },
          );
          appliedEntriesCount += 1;
          continue;
        }

        if (entry.entityType === "deck") {
          await upsertDeckSnapshotInExecutor(
            executor,
            workspaceId,
            {
              deckId: entry.payload.deckId,
              name: entry.payload.name,
              filterDefinition: entry.payload.filterDefinition,
              createdAt: entry.payload.createdAt,
              deletedAt: entry.payload.deletedAt,
            },
            {
              clientUpdatedAt: entry.payload.clientUpdatedAt,
              lastModifiedByDeviceId: entry.payload.lastModifiedByDeviceId,
              lastOperationId: entry.payload.lastOperationId,
            },
          );
          appliedEntriesCount += 1;
          continue;
        }

        await applyWorkspaceSchedulerSettingsSnapshotInExecutor(
          executor,
          workspaceId,
          {
            algorithm: entry.payload.algorithm,
            desiredRetention: entry.payload.desiredRetention,
            learningStepsMinutes: entry.payload.learningStepsMinutes,
            relearningStepsMinutes: entry.payload.relearningStepsMinutes,
            maximumIntervalDays: entry.payload.maximumIntervalDays,
            enableFuzz: entry.payload.enableFuzz,
          },
          {
            clientUpdatedAt: entry.payload.clientUpdatedAt,
            lastModifiedByDeviceId: entry.payload.lastModifiedByDeviceId,
            lastOperationId: entry.payload.lastOperationId,
          },
        );
        appliedEntriesCount += 1;
      }

      return {
        mode: "push",
        appliedEntriesCount,
        bootstrapHotChangeId: await loadCurrentMaxHotChangeId(executor, workspaceId),
      };
    });
  }

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
    const cursor = input.cursor === null
      ? {
        bootstrapHotChangeId: await loadCurrentMaxHotChangeId(executor, workspaceId),
        entityRank: -1,
        entityId: "",
      }
      : decodeBootstrapCursor(input.cursor);
    const remoteIsEmpty = await loadRemoteEmptyState(executor, workspaceId);

    const result = await executor.query<BootstrapProjectionRow>(
      [
        "WITH bootstrap_entries AS (",
        "  SELECT",
        "    0 AS entity_rank,",
        "    'workspace_scheduler_settings'::text AS entity_type,",
        "    workspaces.workspace_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'algorithm', workspaces.fsrs_algorithm,",
        "      'desiredRetention', workspaces.fsrs_desired_retention,",
        "      'learningStepsMinutes', workspaces.fsrs_learning_steps_minutes,",
        "      'relearningStepsMinutes', workspaces.fsrs_relearning_steps_minutes,",
        "      'maximumIntervalDays', workspaces.fsrs_maximum_interval_days,",
        "      'enableFuzz', workspaces.fsrs_enable_fuzz,",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', workspaces.fsrs_client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByDeviceId', workspaces.fsrs_last_modified_by_device_id::text,",
        "      'lastOperationId', workspaces.fsrs_last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', workspaces.fsrs_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
        "    ) AS payload",
        "  FROM org.workspaces AS workspaces",
        "  WHERE workspaces.workspace_id = $1",
        "  UNION ALL",
        "  SELECT",
        "    1 AS entity_rank,",
        "    'card'::text AS entity_type,",
        "    cards.card_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'cardId', cards.card_id::text,",
        "      'frontText', cards.front_text,",
        "      'backText', cards.back_text,",
        "      'tags', cards.tags,",
        "      'effortLevel', cards.effort_level,",
        "      'dueAt', CASE WHEN cards.due_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', cards.due_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END,",
        "      'createdAt', to_char(date_trunc('milliseconds', cards.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'reps', cards.reps,",
        "      'lapses', cards.lapses,",
        "      'fsrsCardState', cards.fsrs_card_state,",
        "      'fsrsStepIndex', cards.fsrs_step_index,",
        "      'fsrsStability', cards.fsrs_stability,",
        "      'fsrsDifficulty', cards.fsrs_difficulty,",
        "      'fsrsLastReviewedAt', CASE WHEN cards.fsrs_last_reviewed_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', cards.fsrs_last_reviewed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END,",
        "      'fsrsScheduledDays', cards.fsrs_scheduled_days,",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', cards.client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByDeviceId', cards.last_modified_by_device_id::text,",
        "      'lastOperationId', cards.last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', cards.updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'deletedAt', CASE WHEN cards.deleted_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', cards.deleted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END",
        "    ) AS payload",
        "  FROM content.cards AS cards",
        "  WHERE cards.workspace_id = $1",
        "  UNION ALL",
        "  SELECT",
        "    2 AS entity_rank,",
        "    'deck'::text AS entity_type,",
        "    decks.deck_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'deckId', decks.deck_id::text,",
        "      'workspaceId', decks.workspace_id::text,",
        "      'name', decks.name,",
        "      'filterDefinition', decks.filter_definition,",
        "      'createdAt', to_char(date_trunc('milliseconds', decks.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', decks.client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByDeviceId', decks.last_modified_by_device_id::text,",
        "      'lastOperationId', decks.last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', decks.updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'deletedAt', CASE WHEN decks.deleted_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', decks.deleted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END",
        "    ) AS payload",
        "  FROM content.decks AS decks",
        "  WHERE decks.workspace_id = $1",
        ")",
        "SELECT entity_rank, entity_type, entity_id, payload",
        "FROM bootstrap_entries",
        "WHERE (entity_rank > $2 OR (entity_rank = $2 AND entity_id > $3))",
        "ORDER BY entity_rank ASC, entity_id ASC",
        "LIMIT $4",
      ].join(" "),
      [workspaceId, cursor.entityRank, cursor.entityId, input.limit + 1],
    );

    const hasMore = result.rows.length > input.limit;
    const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
    const entries = visibleRows.map(parseBootstrapEntryRow);
    const nextRow = hasMore ? visibleRows[visibleRows.length - 1] : undefined;

    return {
      mode: "pull",
      entries,
      nextCursor: nextRow === undefined
        ? null
        : encodeBootstrapCursor({
          bootstrapHotChangeId: cursor.bootstrapHotChangeId,
          entityRank: nextRow.entity_rank,
          entityId: nextRow.entity_id,
        }),
      hasMore,
      bootstrapHotChangeId: cursor.bootstrapHotChangeId,
      remoteIsEmpty,
    };
  });
}

/**
 * Streams review history independently from hot mutable state so a long review
 * log never blocks first-use sync for a new or lagging device.
 */
export async function processSyncReviewHistoryPull(
  workspaceId: string,
  userId: string,
  input: SyncReviewHistoryPullInput,
): Promise<SyncReviewHistoryPullResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  const result = await queryWithWorkspaceScope<ReviewHistoryRow>(
    { userId, workspaceId },
    [
      "SELECT review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server, review_sequence",
      "FROM content.review_events",
      "WHERE workspace_id = $1 AND review_sequence > $2",
      "ORDER BY review_sequence ASC",
      "LIMIT $3",
    ].join(" "),
    [workspaceId, input.afterReviewSequenceId, input.limit + 1],
  );

  const hasMore = result.rows.length > input.limit;
  const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
  const reviewEvents = visibleRows.map((row) => ({
    reviewEventId: row.review_event_id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    deviceId: row.device_id,
    clientEventId: row.client_event_id,
    rating: row.rating,
    reviewedAtClient: toIsoString(row.reviewed_at_client),
    reviewedAtServer: toIsoString(row.reviewed_at_server),
  }));
  const nextReviewSequenceId = visibleRows.length === 0
    ? input.afterReviewSequenceId
    : toNumber(visibleRows[visibleRows.length - 1].review_sequence) ?? input.afterReviewSequenceId;

  return {
    reviewEvents,
    nextReviewSequenceId,
    hasMore,
  };
}

/**
 * Imports append-only review history without replaying schedule mutations. This
 * is used when a local-only workspace links to an empty remote workspace and
 * uploads its archival history in the background.
 */
export async function processSyncReviewHistoryImport(
  workspaceId: string,
  userId: string,
  input: SyncReviewHistoryImportInput,
): Promise<SyncReviewHistoryImportResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    let importedCount = 0;
    let duplicateCount = 0;

    for (const reviewEvent of input.reviewEvents) {
      if (reviewEvent.deviceId !== input.deviceId) {
        throw new HttpError(400, "reviewEvent.deviceId must match the authenticated sync deviceId");
      }

      const mutation = await appendReviewEventSnapshotInExecutor(
        executor,
        workspaceId,
        {
          reviewEventId: reviewEvent.reviewEventId,
          workspaceId,
          cardId: reviewEvent.cardId,
          deviceId: reviewEvent.deviceId,
          clientEventId: reviewEvent.clientEventId,
          rating: reviewEvent.rating,
          reviewedAtClient: reviewEvent.reviewedAtClient,
          reviewedAtServer: reviewEvent.reviewedAtServer,
        },
        reviewEvent.reviewEventId,
      );

      if (mutation.applied) {
        importedCount += 1;
      } else {
        duplicateCount += 1;
      }
    }

    return {
      importedCount,
      duplicateCount,
      nextReviewSequenceId: await loadCurrentReviewSequenceId(executor, workspaceId),
    };
  });
}
