import { z } from "zod";
import { HttpError } from "../errors";
import type {
  HttpErrorDetails,
  ValidationIssueSummary,
} from "../errors";
import { normalizeIsoTimestamp } from "../lww";

type Platform = "ios" | "android" | "web";

const effortLevelSchema = z.enum(["fast", "medium", "long"]);
const fsrsCardStateSchema = z.enum(["new", "learning", "review", "relearning"]);
const reviewRatingSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const platformSchema = z.enum(["ios", "android", "web"]);
const isoTimestampStringSchema = z.string().datetime();
const isoDatePrefixPattern = /^(\d{4})-(\d{2})-(\d{2})T/i;
const commonDaysByMonth: ReadonlyArray<number> = [
  31,
  28,
  31,
  30,
  31,
  30,
  31,
  31,
  30,
  31,
  30,
  31,
];

type IsoDateParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) {
    return true;
  }

  if (year % 100 === 0) {
    return false;
  }

  return year % 4 === 0;
}

function getDaysInMonth(year: number, month: number): number | null {
  if (month < 1 || month > 12) {
    return null;
  }

  if (month === 2 && isLeapYear(year)) {
    return 29;
  }

  return commonDaysByMonth[month - 1] ?? null;
}

function parseIsoDateParts(value: string): IsoDateParts | null {
  const match = isoDatePrefixPattern.exec(value);
  if (match === null) {
    return null;
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (
    yearText === undefined
    || monthText === undefined
    || dayText === undefined
  ) {
    return null;
  }

  return {
    year: Number.parseInt(yearText, 10),
    month: Number.parseInt(monthText, 10),
    day: Number.parseInt(dayText, 10),
  };
}

function hasValidCalendarDate(value: string): boolean {
  const parts = parseIsoDateParts(value);
  if (parts === null) {
    return false;
  }

  const daysInMonth = getDaysInMonth(parts.year, parts.month);
  return daysInMonth !== null && parts.day >= 1 && parts.day <= daysInMonth;
}

function validateDueAtTimestamp(value: string, refinementContext: z.core.$RefinementCtx): void {
  const parsedTimestamp = isoTimestampStringSchema.safeParse(value);
  if (!parsedTimestamp.success) {
    refinementContext.addIssue({
      code: "custom",
      message: `dueAt must be a valid ISO timestamp string; received ${JSON.stringify(value)}`,
    });
    return;
  }

  if (hasValidCalendarDate(value)) {
    return;
  }

  refinementContext.addIssue({
    code: "custom",
    message: `dueAt must be a valid calendar ISO timestamp; received ${JSON.stringify(value)}`,
  });
}

const dueAtTimestampSchema = z.string().superRefine(validateDueAtTimestamp);

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
  dueAt: dueAtTimestampSchema.nullable(),
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

export const cardPayloadSchema = cardSnapshotSchema.extend({
  clientUpdatedAt: z.string().datetime(),
  lastModifiedByReplicaId: z.string().min(1),
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

export const deckPayloadSchema = deckSnapshotSchema.extend({
  workspaceId: z.string().min(1),
  clientUpdatedAt: z.string().datetime(),
  lastModifiedByReplicaId: z.string().min(1),
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

export const workspaceSchedulerSettingsPayloadSchema = workspaceSchedulerSettingsSnapshotSchema.extend({
  clientUpdatedAt: z.string().datetime(),
  lastModifiedByReplicaId: z.string().min(1),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
});

const reviewEventPushPayloadSchema = z.object({
  reviewEventId: z.string().min(1),
  cardId: z.string().min(1),
  clientEventId: z.string().min(1),
  rating: reviewRatingSchema,
  reviewedAtClient: z.string().datetime(),
});

const reviewEventImportPayloadSchema = reviewEventPushPayloadSchema.extend({
  workspaceId: z.string().min(1),
  reviewedAtServer: z.string().datetime(),
});

const cardBootstrapPushPayloadSchema = cardSnapshotSchema.extend({
  clientUpdatedAt: z.string().datetime(),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
});

const deckBootstrapPushPayloadSchema = deckSnapshotSchema.extend({
  workspaceId: z.string().min(1),
  clientUpdatedAt: z.string().datetime(),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
});

const workspaceSchedulerSettingsBootstrapPushPayloadSchema = workspaceSchedulerSettingsSnapshotSchema.extend({
  clientUpdatedAt: z.string().datetime(),
  lastOperationId: z.string().min(1),
  updatedAt: z.string().datetime(),
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

const syncPushOperationSchema = z.discriminatedUnion("entityType", [
  cardOperationSchema,
  deckOperationSchema,
  workspaceSchedulerSettingsOperationSchema,
  reviewEventOperationSchema,
]);

const syncPushInputBaseSchema = z.object({
  installationId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  operations: z.array(syncPushOperationSchema),
});

type SyncPushInputBase = z.infer<typeof syncPushInputBaseSchema>;

function validateSyncPushReviewEventTimestamps(
  input: SyncPushInputBase,
  refinementContext: z.core.$RefinementCtx,
): void {
  for (const [operationIndex, operation] of input.operations.entries()) {
    if (operation.entityType !== "review_event") {
      continue;
    }

    const normalizedClientUpdatedAt = normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt");
    const normalizedReviewedAtClient = normalizeIsoTimestamp(operation.payload.reviewedAtClient, "reviewedAtClient");
    if (normalizedClientUpdatedAt === normalizedReviewedAtClient) {
      continue;
    }

    refinementContext.addIssue({
      code: "custom",
      path: ["operations", operationIndex, "clientUpdatedAt"],
      message: "review_event clientUpdatedAt must match payload.reviewedAtClient",
    });
  }
}

const syncPushInputSchema = syncPushInputBaseSchema.superRefine(validateSyncPushReviewEventTimestamps);

const syncPullInputSchema = z.object({
  installationId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  afterHotChangeId: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
});

const syncBootstrapPullInputSchema = z.object({
  mode: z.literal("pull"),
  installationId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  cursor: z.string().min(1).nullable(),
  limit: z.number().int().positive().max(500),
});

const syncBootstrapPushInputSchema = z.object({
  mode: z.literal("push"),
  installationId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  entries: z.array(
    z.discriminatedUnion("entityType", [
      z.object({
        entityType: z.literal("card"),
        entityId: z.string().min(1),
        action: z.literal("upsert"),
        payload: cardBootstrapPushPayloadSchema,
      }),
      z.object({
        entityType: z.literal("deck"),
        entityId: z.string().min(1),
        action: z.literal("upsert"),
        payload: deckBootstrapPushPayloadSchema,
      }),
      z.object({
        entityType: z.literal("workspace_scheduler_settings"),
        entityId: z.string().min(1),
        action: z.literal("upsert"),
        payload: workspaceSchedulerSettingsBootstrapPushPayloadSchema,
      }),
    ]),
  ),
});

const syncReviewHistoryPullInputSchema = z.object({
  installationId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  afterReviewSequenceId: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
});

const syncReviewHistoryImportInputSchema = z.object({
  installationId: z.string().min(1),
  platform: platformSchema,
  appVersion: z.string().min(1).nullable().optional(),
  reviewEvents: z.array(reviewEventImportPayloadSchema),
});

export type SyncPushInput = z.infer<typeof syncPushInputSchema>;
export type SyncPullInput = z.infer<typeof syncPullInputSchema>;
export type SyncBootstrapInput =
  | z.infer<typeof syncBootstrapPullInputSchema>
  | z.infer<typeof syncBootstrapPushInputSchema>;
export type SyncReviewHistoryPullInput = z.infer<typeof syncReviewHistoryPullInputSchema>;
export type SyncReviewHistoryImportInput = z.infer<typeof syncReviewHistoryImportInputSchema>;
export type SyncPushOperation = SyncPushInput["operations"][number];
export type SyncBootstrapPushEntry = z.infer<typeof syncBootstrapPushInputSchema>["entries"][number];
export type SyncReviewHistoryImportEvent = SyncReviewHistoryImportInput["reviewEvents"][number];

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

export function parseSyncPushInput(value: unknown): SyncPushInput {
  return parseOrThrow(syncPushInputSchema, value);
}

export function parseSyncPullInput(value: unknown): SyncPullInput {
  return parseOrThrow(syncPullInputSchema, value);
}

export function parseSyncBootstrapInput(value: unknown): SyncBootstrapInput {
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

export type { Platform };
