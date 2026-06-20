import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../observability/sentry";

initializeBackendSentry("progress-active-days-backfill");

type ProgressActiveDaysBackfillEvent = Readonly<{
  batchSize?: unknown;
  maxPages?: unknown;
}>;

type ProgressActiveDaysBackfillResponse = Readonly<{
  ok: true;
  batchSize: number;
  maxPages: number;
  pagesScanned: number;
  usersScanned: number;
  usersMaterialized: number;
  reviewEventsMaterialized: number;
  activeReviewDaysUpserted: number;
  skippedUsers: number;
  errors: number;
  finished: boolean;
}>;

type ProgressActiveDaysBackfillRuntime = Readonly<{
  backfillActiveReviewDays: typeof import("../progress/activeReviewDaysBackfill").backfillActiveReviewDays;
}>;

const scheduledBatchSize = 25;
const scheduledMaxPages = 20;
const maximumBatchSize = 100;
const maximumMaxPages = 100;

let progressActiveDaysBackfillRuntimePromise: Promise<ProgressActiveDaysBackfillRuntime> | null = null;

async function createProgressActiveDaysBackfillRuntime(): Promise<ProgressActiveDaysBackfillRuntime> {
  const { backfillActiveReviewDays } = await import("../progress/activeReviewDaysBackfill");
  return {
    backfillActiveReviewDays,
  };
}

function getProgressActiveDaysBackfillRuntime(): Promise<ProgressActiveDaysBackfillRuntime> {
  if (progressActiveDaysBackfillRuntimePromise === null) {
    progressActiveDaysBackfillRuntimePromise = createProgressActiveDaysBackfillRuntime();
  }

  return progressActiveDaysBackfillRuntimePromise;
}

function readOptionalIntegerField(
  event: ProgressActiveDaysBackfillEvent,
  fieldName: "batchSize" | "maxPages",
): number | null {
  const value = event[fieldName];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer when provided`);
  }

  return value;
}

function resolveBoundedInteger(
  value: number | null,
  fallbackValue: number,
  fieldName: "batchSize" | "maxPages",
  maximumValue: number,
): number {
  const resolvedValue = value ?? fallbackValue;
  if (resolvedValue < 1 || resolvedValue > maximumValue) {
    throw new Error(`${fieldName} must be between 1 and ${maximumValue}`);
  }

  return resolvedValue;
}

function createBackfillRequest(event: ProgressActiveDaysBackfillEvent): Readonly<{
  batchSize: number;
  maxPages: number;
}> {
  return {
    batchSize: resolveBoundedInteger(
      readOptionalIntegerField(event, "batchSize"),
      scheduledBatchSize,
      "batchSize",
      maximumBatchSize,
    ),
    maxPages: resolveBoundedInteger(
      readOptionalIntegerField(event, "maxPages"),
      scheduledMaxPages,
      "maxPages",
      maximumMaxPages,
    ),
  };
}

function createFailureDetails(
  request: Readonly<{ batchSize: number; maxPages: number }> | null,
  error: Error,
): Readonly<{
  batchSize: number | null;
  maxPages: number | null;
  message: string;
}> {
  return {
    batchSize: request?.batchSize ?? null,
    maxPages: request?.maxPages ?? null,
    message: error.message,
  };
}

const progressActiveDaysBackfillHandler: Handler<
  ProgressActiveDaysBackfillEvent,
  ProgressActiveDaysBackfillResponse
> = async (event, context) => {
  const observationScope = createBackendObservationScope(
    "progress-active-days-backfill",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  let request: Readonly<{ batchSize: number; maxPages: number }> | null = null;
  try {
    request = createBackfillRequest(event);
    const runtime = await getProgressActiveDaysBackfillRuntime();
    const result = await runtime.backfillActiveReviewDays(request, observationScope);

    addBackendBreadcrumb({
      action: "progress_active_days_backfill_completed",
      scope: observationScope,
      details: {
        batchSize: request.batchSize,
        maxPages: request.maxPages,
        pagesScanned: result.pagesScanned,
        usersScanned: result.usersScanned,
        usersMaterialized: result.usersMaterialized,
        reviewEventsMaterialized: result.reviewEventsMaterialized,
        activeReviewDaysUpserted: result.activeReviewDaysUpserted,
        skippedUsers: result.skippedUsers,
        errors: result.errors,
        finished: result.finished,
      },
    });

    return {
      ok: true,
      batchSize: request.batchSize,
      maxPages: request.maxPages,
      pagesScanned: result.pagesScanned,
      usersScanned: result.usersScanned,
      usersMaterialized: result.usersMaterialized,
      reviewEventsMaterialized: result.reviewEventsMaterialized,
      activeReviewDaysUpserted: result.activeReviewDaysUpserted,
      skippedUsers: result.skippedUsers,
      errors: result.errors,
      finished: result.finished,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "progress_active_days_backfill_failed",
      error: normalizedError,
      scope: observationScope,
      details: createFailureDetails(request, normalizedError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(progressActiveDaysBackfillHandler);
