import { z } from "zod";
import {
  listCardChanges,
  upsertCardSnapshotInExecutor,
  type Card,
} from "./cards";
import { transaction, query, type DatabaseExecutor } from "./db";
import {
  ensureSyncDevice,
  type SyncDevicePlatform,
} from "./devices";
import {
  listDeckChanges,
  upsertDeckSnapshotInExecutor,
  type Deck,
} from "./decks";
import { HttpError } from "./errors";
import { normalizeIsoTimestamp } from "./lww";
import {
  applyWorkspaceSchedulerSettingsSnapshotInExecutor,
  listWorkspaceSchedulerSettingsChanges,
  type WorkspaceSchedulerSettings,
} from "./workspaceSchedulerSettings";

type TimestampValue = Date | string;

type AppliedOperationRow = Readonly<{
  resulting_server_version: string | number | null;
}>;

type ReviewEventRow = Readonly<{
  review_event_id: string;
  workspace_id: string;
  card_id: string;
  device_id: string;
  client_event_id: string;
  rating: number;
  reviewed_at_client: TimestampValue;
  reviewed_at_server: TimestampValue;
  server_version: string | number;
}>;

export type SyncReviewEvent = Readonly<{
  reviewEventId: string;
  workspaceId: string;
  cardId: string;
  deviceId: string;
  clientEventId: string;
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
  serverVersion: number;
}>;

const effortLevelSchema = z.enum(["fast", "medium", "long"]);
const fsrsCardStateSchema = z.enum(["new", "learning", "review", "relearning"]);
const reviewRatingSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const platformSchema = z.enum(["ios", "android", "web"]);

const cardPayloadSchema = z.object({
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

const deckPredicateSchema = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("effortLevel"),
    operator: z.literal("in"),
    values: z.array(effortLevelSchema).min(1),
  }),
  z.object({
    field: z.literal("tags"),
    operator: z.union([z.literal("containsAny"), z.literal("containsAll")]),
    values: z.array(z.string()).min(1),
  }),
]);

const deckFilterDefinitionSchema = z.object({
  version: z.literal(1),
  combineWith: z.union([z.literal("and"), z.literal("or")]),
  predicates: z.array(deckPredicateSchema),
});

const deckPayloadSchema = z.object({
  deckId: z.string().min(1),
  name: z.string().min(1),
  filterDefinition: deckFilterDefinitionSchema,
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

const workspaceSchedulerSettingsPayloadSchema = z.object({
  algorithm: z.literal("fsrs-6"),
  desiredRetention: z.number().gt(0).lt(1),
  learningStepsMinutes: z.array(z.number().int().positive()).min(1),
  relearningStepsMinutes: z.array(z.number().int().positive()).min(1),
  maximumIntervalDays: z.number().int().positive(),
  enableFuzz: z.boolean(),
});

const reviewEventPayloadSchema = z.object({
  reviewEventId: z.string().min(1),
  cardId: z.string().min(1),
  deviceId: z.string().min(1),
  clientEventId: z.string().min(1),
  rating: reviewRatingSchema,
  reviewedAtClient: z.string().datetime(),
});

const baseOperationSchema = z.object({
  operationId: z.string().min(1),
  entityId: z.string().min(1),
  clientUpdatedAt: z.string().datetime(),
});

const cardOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("card"),
  operationType: z.literal("upsert"),
  payload: cardPayloadSchema,
});

const deckOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("deck"),
  operationType: z.literal("upsert"),
  payload: deckPayloadSchema,
});

const workspaceSchedulerSettingsOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("workspace_scheduler_settings"),
  operationType: z.literal("upsert"),
  payload: workspaceSchedulerSettingsPayloadSchema,
});

const reviewEventOperationSchema = baseOperationSchema.extend({
  entityType: z.literal("review_event"),
  operationType: z.literal("append"),
  payload: reviewEventPayloadSchema,
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
  cursors: z.object({
    cards: z.number().int().nonnegative(),
    decks: z.number().int().nonnegative(),
    reviewEvents: z.number().int().nonnegative(),
    fsrs: z.number().int().nonnegative(),
  }),
});

export type SyncPushInput = z.infer<typeof syncPushInputSchema>;
export type SyncPullInput = z.infer<typeof syncPullInputSchema>;
export type SyncPushOperation = SyncPushInput["operations"][number];

export type SyncPushOperationResult = Readonly<{
  operationId: string;
  entityType: SyncPushOperation["entityType"];
  entityId: string;
  status: "applied" | "ignored" | "duplicate";
  resultingServerVersion: number | null;
}>;

export type SyncPushResult = Readonly<{
  operations: ReadonlyArray<SyncPushOperationResult>;
}>;

export type SyncPullResult = Readonly<{
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewEvents: ReadonlyArray<SyncReviewEvent>;
  schedulerSettings: ReadonlyArray<WorkspaceSchedulerSettings>;
  cursors: Readonly<{
    cards: number;
    decks: number;
    reviewEvents: number;
    fsrs: number;
  }>;
}>;

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function mapReviewEvent(row: ReviewEventRow): SyncReviewEvent {
  return {
    reviewEventId: row.review_event_id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    deviceId: row.device_id,
    clientEventId: row.client_event_id,
    rating: row.rating,
    reviewedAtClient: toIsoString(row.reviewed_at_client),
    reviewedAtServer: toIsoString(row.reviewed_at_server),
    serverVersion: toNumber(row.server_version) ?? 0,
  };
}

function toValidationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

function nextCursor(currentCursor: number, values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    return currentCursor;
  }

  return Math.max(currentCursor, ...values);
}

async function appendReviewEventInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deviceId: string,
  operation: z.infer<typeof reviewEventOperationSchema>,
): Promise<Readonly<{
  reviewEvent: SyncReviewEvent;
  inserted: boolean;
}>> {
  if (operation.payload.deviceId !== deviceId) {
    throw new HttpError(400, "review_event payload deviceId must match the authenticated sync deviceId");
  }

  const normalizedClientUpdatedAt = normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt");
  const normalizedReviewedAtClient = normalizeIsoTimestamp(operation.payload.reviewedAtClient, "reviewedAtClient");
  if (normalizedClientUpdatedAt !== normalizedReviewedAtClient) {
    throw new HttpError(400, "review_event clientUpdatedAt must match reviewedAtClient");
  }

  const insertResult = await executor.query<ReviewEventRow>(
    [
      "INSERT INTO content.review_events",
      "(",
      "review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, server_version",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, DEFAULT)",
      "ON CONFLICT (workspace_id, device_id, client_event_id) DO NOTHING",
      "RETURNING review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server, server_version",
    ].join(" "),
    [
      operation.payload.reviewEventId,
      workspaceId,
      operation.payload.cardId,
      deviceId,
      operation.payload.clientEventId,
      operation.payload.rating,
      normalizedReviewedAtClient,
    ],
  );

  const insertedRow = insertResult.rows[0];
  if (insertedRow !== undefined) {
    return {
      reviewEvent: mapReviewEvent(insertedRow),
      inserted: true,
    };
  }

  const existingResult = await executor.query<ReviewEventRow>(
    [
      "SELECT review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server, server_version",
      "FROM content.review_events",
      "WHERE workspace_id = $1 AND (review_event_id = $2 OR (device_id = $3 AND client_event_id = $4))",
      "ORDER BY reviewed_at_server DESC",
      "LIMIT 1",
      "FOR UPDATE",
    ].join(" "),
    [
      workspaceId,
      operation.payload.reviewEventId,
      deviceId,
      operation.payload.clientEventId,
    ],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow === undefined) {
    throw new Error("Review event insert returned no row and no existing replacement row");
  }

  return {
    reviewEvent: mapReviewEvent(existingRow),
    inserted: false,
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
      "SELECT resulting_server_version",
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
      resultingServerVersion: toNumber(existingLedgerRow.resulting_server_version),
    };
  }

  let status: SyncPushOperationResult["status"] = "applied";
  let resultingServerVersion: number | null = null;

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
    resultingServerVersion = mutation.card.serverVersion;
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
    resultingServerVersion = mutation.deck.serverVersion;
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
    resultingServerVersion = mutation.settings.serverVersion;
  } else {
    if (operation.entityId !== operation.payload.reviewEventId) {
      throw new HttpError(400, "review_event entityId must match payload.reviewEventId");
    }

    const mutation = await appendReviewEventInExecutor(executor, workspaceId, deviceId, operation);
    status = mutation.inserted ? "applied" : "ignored";
    resultingServerVersion = mutation.reviewEvent.serverVersion;
  }

  await executor.query(
    [
      "INSERT INTO sync.applied_operations",
      "(",
      "workspace_id, device_id, operation_id, operation_type, applied_at, entity_type, entity_id, client_updated_at, resulting_server_version",
      ")",
      "VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8)",
    ].join(" "),
    [
      workspaceId,
      deviceId,
      operation.operationId,
      operation.operationType,
      operation.entityType,
      operation.entityId,
      normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt"),
      resultingServerVersion,
    ],
  );

  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status,
    resultingServerVersion,
  };
}

async function listReviewEventChanges(
  workspaceId: string,
  afterServerVersion: number,
): Promise<ReadonlyArray<SyncReviewEvent>> {
  const result = await query<ReviewEventRow>(
    [
      "SELECT review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server, server_version",
      "FROM content.review_events",
      "WHERE workspace_id = $1 AND server_version > $2",
      "ORDER BY server_version ASC",
    ].join(" "),
    [workspaceId, afterServerVersion],
  );

  return result.rows.map(mapReviewEvent);
}

export function parseSyncPushInput(value: unknown): SyncPushInput {
  const parsedInput = syncPushInputSchema.safeParse(value);
  if (parsedInput.success) {
    return parsedInput.data;
  }

  throw new HttpError(400, toValidationMessage(parsedInput.error));
}

export function parseSyncPullInput(value: unknown): SyncPullInput {
  const parsedInput = syncPullInputSchema.safeParse(value);
  if (parsedInput.success) {
    return parsedInput.data;
  }

  throw new HttpError(400, toValidationMessage(parsedInput.error));
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
    const operationResult = await transaction(async (executor) => {
      return processOperationInExecutor(executor, workspaceId, input.deviceId, operation);
    });
    operationResults.push(operationResult);
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

  const [cards, decks, reviewEvents, schedulerSettings] = await Promise.all([
    listCardChanges(workspaceId, input.cursors.cards),
    listDeckChanges(workspaceId, input.cursors.decks),
    listReviewEventChanges(workspaceId, input.cursors.reviewEvents),
    listWorkspaceSchedulerSettingsChanges(workspaceId, input.cursors.fsrs),
  ]);

  return {
    cards,
    decks,
    reviewEvents,
    schedulerSettings,
    cursors: {
      cards: nextCursor(input.cursors.cards, cards.map((card) => card.serverVersion)),
      decks: nextCursor(input.cursors.decks, decks.map((deck) => deck.serverVersion)),
      reviewEvents: nextCursor(input.cursors.reviewEvents, reviewEvents.map((reviewEvent) => reviewEvent.serverVersion)),
      fsrs: nextCursor(input.cursors.fsrs, schedulerSettings.map((settings) => settings.serverVersion)),
    },
  };
}
