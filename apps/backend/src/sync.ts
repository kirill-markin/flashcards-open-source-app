import { z } from "zod";
import {
  appendReviewEventSnapshotInExecutor,
  upsertCardSnapshotInExecutor,
  type Card,
  type ReviewEvent,
} from "./cards";
import { query, transaction, type DatabaseExecutor } from "./db";
import {
  ensureSyncDevice,
  type SyncDevicePlatform,
} from "./devices";
import {
  upsertDeckSnapshotInExecutor,
  type Deck,
} from "./decks";
import { HttpError } from "./errors";
import { normalizeIsoTimestamp } from "./lww";
import {
  applyWorkspaceSchedulerSettingsSnapshotInExecutor,
  type WorkspaceSchedulerSettings,
} from "./workspaceSchedulerSettings";
import type { HttpErrorDetails, ValidationIssueSummary } from "./errors";

type TimestampValue = Date | string;

type AppliedOperationRow = Readonly<{
  resulting_change_id: string | number | null;
}>;

type ChangeFeedRow = Readonly<{
  change_id: string | number;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncAction;
  payload: unknown;
}>;

type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings" | "review_event";
type SyncAction = "upsert" | "append";

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
  backText: z.string().min(1),
  tags: z.array(z.string()),
  effortLevel: effortLevelSchema,
  dueAt: z.string().datetime().nullable(),
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

const cardChangePayloadSchema = cardSnapshotSchema.extend({
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

const deckChangePayloadSchema = deckSnapshotSchema.extend({
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

const workspaceSchedulerSettingsChangePayloadSchema = workspaceSchedulerSettingsSnapshotSchema.extend({
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

const reviewEventChangePayloadSchema = reviewEventPushPayloadSchema.extend({
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

const syncPullInputSchema = z.object({
  deviceId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  afterChangeId: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
});

export type SyncPushInput = z.infer<typeof syncPushInputSchema>;
export type SyncPullInput = z.infer<typeof syncPullInputSchema>;
export type SyncPushOperation = SyncPushInput["operations"][number];

export type SyncChange =
  | Readonly<{
    changeId: number;
    entityType: "card";
    entityId: string;
    action: "upsert";
    payload: Card;
  }>
  | Readonly<{
    changeId: number;
    entityType: "deck";
    entityId: string;
    action: "upsert";
    payload: Deck;
  }>
  | Readonly<{
    changeId: number;
    entityType: "workspace_scheduler_settings";
    entityId: string;
    action: "upsert";
    payload: WorkspaceSchedulerSettings;
  }>
  | Readonly<{
    changeId: number;
    entityType: "review_event";
    entityId: string;
    action: "append";
    payload: ReviewEvent;
  }>;

export type SyncPushOperationResult = Readonly<{
  operationId: string;
  entityType: SyncPushOperation["entityType"];
  entityId: string;
  status: "applied" | "ignored" | "duplicate";
  resultingChangeId: number | null;
}>;

export type SyncPushResult = Readonly<{
  operations: ReadonlyArray<SyncPushOperationResult>;
}>;

export type SyncPullResult = Readonly<{
  changes: ReadonlyArray<SyncChange>;
  nextChangeId: number;
  hasMore: boolean;
}>;

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toValidationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
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

function parseChangeRow(row: ChangeFeedRow): SyncChange {
  const changeId = toNumber(row.change_id);
  if (changeId === null) {
    throw new Error("sync.changes.change_id must not be NULL");
  }

  if (row.entity_type === "card") {
    return {
      changeId,
      entityType: "card",
      entityId: row.entity_id,
      action: "upsert",
      payload: cardChangePayloadSchema.parse(row.payload),
    };
  }

  if (row.entity_type === "deck") {
    return {
      changeId,
      entityType: "deck",
      entityId: row.entity_id,
      action: "upsert",
      payload: deckChangePayloadSchema.parse(row.payload),
    };
  }

  if (row.entity_type === "workspace_scheduler_settings") {
    return {
      changeId,
      entityType: "workspace_scheduler_settings",
      entityId: row.entity_id,
      action: "upsert",
      payload: workspaceSchedulerSettingsChangePayloadSchema.parse(row.payload),
    };
  }

  return {
    changeId,
    entityType: "review_event",
    entityId: row.entity_id,
    action: "append",
    payload: reviewEventChangePayloadSchema.parse(row.payload),
  };
}

async function processOperationInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deviceId: string,
  operation: SyncPushOperation,
): Promise<SyncPushOperationResult> {
  const existingApplied = await executor.query<AppliedOperationRow>(
    [
      "SELECT resulting_change_id",
      "FROM sync.applied_operations",
      "WHERE workspace_id = $1 AND device_id = $2 AND operation_id = $3",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, deviceId, operation.operationId],
  );

  const existingLedgerRow = existingApplied.rows[0];
  if (existingLedgerRow !== undefined) {
    return {
      operationId: operation.operationId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      status: "duplicate",
      resultingChangeId: toNumber(existingLedgerRow.resulting_change_id),
    };
  }

  let status: SyncPushOperationResult["status"] = "applied";
  let resultingChangeId: number | null = null;

  if (operation.entityType === "card") {
    if (operation.entityId !== operation.payload.cardId) {
      throw new HttpError(400, "card entityId must match payload.cardId");
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
    resultingChangeId = mutation.changeId;
  } else if (operation.entityType === "deck") {
    if (operation.entityId !== operation.payload.deckId) {
      throw new HttpError(400, "deck entityId must match payload.deckId");
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
    resultingChangeId = mutation.changeId;
  } else if (operation.entityType === "workspace_scheduler_settings") {
    if (operation.entityId !== workspaceId) {
      throw new HttpError(400, "workspace_scheduler_settings entityId must match the authenticated workspaceId");
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
    resultingChangeId = mutation.changeId;
  } else {
    if (operation.entityId !== operation.payload.reviewEventId) {
      throw new HttpError(400, "review_event entityId must match payload.reviewEventId");
    }

    if (operation.payload.deviceId !== deviceId) {
      throw new HttpError(400, "review_event payload.deviceId must match the authenticated sync deviceId");
    }

    const normalizedClientUpdatedAt = normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt");
    const normalizedReviewedAtClient = normalizeIsoTimestamp(operation.payload.reviewedAtClient, "reviewedAtClient");
    if (normalizedClientUpdatedAt !== normalizedReviewedAtClient) {
      throw new HttpError(400, "review_event clientUpdatedAt must match reviewedAtClient");
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
    resultingChangeId = mutation.changeId;
  }

  await executor.query(
    [
      "INSERT INTO sync.applied_operations",
      "(",
      "workspace_id, device_id, operation_id, operation_type, applied_at, entity_type, entity_id, client_updated_at, resulting_change_id",
      ")",
      "VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8)",
    ].join(" "),
    [
      workspaceId,
      deviceId,
      operation.operationId,
      operation.action,
      operation.entityType,
      operation.entityId,
      normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt"),
      resultingChangeId,
    ],
  );

  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status,
    resultingChangeId,
  };
}

export function parseSyncPushInput(value: unknown): SyncPushInput {
  const parsedInput = syncPushInputSchema.safeParse(value);
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

export function parseSyncPullInput(value: unknown): SyncPullInput {
  const parsedInput = syncPullInputSchema.safeParse(value);
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

  const operationResults: Array<SyncPushOperationResult> = [];
  for (const operation of input.operations) {
    operationResults.push(
      await transaction(async (executor) => processOperationInExecutor(executor, workspaceId, input.deviceId, operation)),
    );
  }

  return {
    operations: operationResults,
  };
}

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

  const result = await query<ChangeFeedRow>(
    [
      "SELECT change_id, entity_type, entity_id, action, payload",
      "FROM sync.changes",
      "WHERE workspace_id = $1 AND change_id > $2",
      "ORDER BY change_id ASC",
      "LIMIT $3",
    ].join(" "),
    [workspaceId, input.afterChangeId, input.limit + 1],
  );

  const hasMore = result.rows.length > input.limit;
  const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
  const changes = visibleRows.map(parseChangeRow);
  const nextChangeId = changes.length === 0
    ? input.afterChangeId
    : changes[changes.length - 1].changeId;

  return {
    changes,
    nextChangeId,
    hasMore,
  };
}
