import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";

initializeBackendSentry("web-guest-reaper");

type WebGuestReaperEvent = Readonly<{
  batchSize?: unknown;
  maxPages?: unknown;
}>;

type WebGuestReaperResponse = Readonly<{
  ok: true;
  batchSize: number;
  maxPages: number;
  inactivityThresholdDays: number;
  inactiveBefore: string;
  pagesScanned: number;
  candidatesExamined: number;
  deleted: number;
  skipped: number;
  skippedWorkspaceHasContent: number;
  skippedWorkspaceNotSoleOwned: number;
  skippedWorkspaceMissing: number;
  skippedNoLongerCandidate: number;
  interrupted: number;
  failed: number;
  finished: boolean;
}>;

type WebGuestReaperRuntime = Readonly<{
  reapInactiveWebGuests: typeof import("../../guestAuth/reaper").reapInactiveWebGuests;
}>;

// One daily invocation walks up to scheduledBatchSize * scheduledMaxPages guests, which has to stay
// comfortably above the rate signed-out browsers mint web guest rows; a run that cannot keep up
// returns finished: false rather than silently capping. The Lambda deadline, not this product, is
// the real bound on a slow run.
const scheduledBatchSize = 500;
const scheduledMaxPages = 5;
const maximumBatchSize = 2_000;
const maximumMaxPages = 100;
// Held back from the deadline handed to the run so the completion record below still gets written
// after the loop returns. It covers finalization only: the run keeps its own reserve for each unit
// of work it starts, so no scan or guest transaction is begun that could still be running when this
// reserve starts.
const finalizationReserveMs = 10_000;

let webGuestReaperRuntimePromise: Promise<WebGuestReaperRuntime> | null = null;

async function createWebGuestReaperRuntime(): Promise<WebGuestReaperRuntime> {
  const { reapInactiveWebGuests } = await import("../../guestAuth/reaper");
  return {
    reapInactiveWebGuests,
  };
}

function getWebGuestReaperRuntime(): Promise<WebGuestReaperRuntime> {
  if (webGuestReaperRuntimePromise === null) {
    webGuestReaperRuntimePromise = createWebGuestReaperRuntime();
  }

  return webGuestReaperRuntimePromise;
}

export function calculateWebGuestReaperDeadlineAtMs(nowMs: number, remainingTimeMs: number): number {
  if (
    !Number.isSafeInteger(nowMs)
    || nowMs < 1
    || !Number.isSafeInteger(remainingTimeMs)
    || remainingTimeMs < 0
  ) {
    throw new RangeError("Web guest reaper deadline inputs must be non-negative safe integers.");
  }

  return nowMs + Math.max(0, remainingTimeMs - finalizationReserveMs);
}

function readOptionalIntegerField(
  event: WebGuestReaperEvent,
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

function createReaperRequest(event: WebGuestReaperEvent): Readonly<{
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

const webGuestReaperHandler: Handler<WebGuestReaperEvent, WebGuestReaperResponse> = async (
  event,
  context,
) => {
  const observationScope = createBackendObservationScope(
    "web-guest-reaper",
    context.awsRequestId ?? null,
    null,
    null,
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
    request = createReaperRequest(event);
    const runtime = await getWebGuestReaperRuntime();
    const result = await runtime.reapInactiveWebGuests(
      {
        batchSize: request.batchSize,
        maxPages: request.maxPages,
        deadlineAtMs: calculateWebGuestReaperDeadlineAtMs(
          Date.now(),
          context.getRemainingTimeInMillis(),
        ),
      },
      observationScope,
    );

    addBackendBreadcrumb({
      action: "web_guest_reaper_completed",
      scope: observationScope,
      details: {
        batchSize: request.batchSize,
        maxPages: request.maxPages,
        inactivityThresholdDays: result.inactivityThresholdDays,
        inactiveBeforeUtc: result.inactiveBefore,
        pagesScanned: result.pagesScanned,
        candidatesExamined: result.candidatesExamined,
        deleted: result.deleted,
        skipped: result.skipped,
        skippedWorkspaceHasContent: result.skippedWorkspaceHasContent,
        skippedWorkspaceNotSoleOwned: result.skippedWorkspaceNotSoleOwned,
        skippedWorkspaceMissing: result.skippedWorkspaceMissing,
        skippedNoLongerCandidate: result.skippedNoLongerCandidate,
        interrupted: result.interrupted,
        failed: result.failed,
        scanFailed: result.scanFailed,
        finished: result.finished,
      },
    });

    // A candidate scan that throws is caught by the run so the record above still reports the
    // guests it had already deleted permanently, but the invocation must not end cleanly:
    // WebGuestReaperLambdaErrorAlarm is the stated reason the deferred auth.guest_sessions
    // (platform, created_at) index is safe to defer, and the unindexed scan outgrowing the
    // reporting role's 30s statement_timeout is exactly the failure it has to see. The staleness
    // alarm cannot stand in for it, because an errored invocation still counts in Invocations.
    if (result.scanFailed) {
      throw new Error(`Web guest reaper stopped on a failed candidate scan after ${result.pagesScanned} scanned pages, having deleted ${result.deleted} guests and failed on ${result.failed}`);
    }

    // Every guest is deleted in its own transaction, so the batch completes even when one guest
    // fails. The run still has to report failure, otherwise a guest that fails on every invocation
    // is invisible outside its own warning record. A run that only ran out of time reports
    // interrupted rather than failed, so it does not reach this throw. Both the schedule's retry
    // policy and the function's own async retry attempts are pinned to 0 for exactly this throw: a
    // destructive job must not be replayed against the same poison candidate, and the failure
    // reaches an operator through the Lambda error alarm instead.
    if (result.failed > 0) {
      throw new Error(`Web guest reaper failed to delete ${result.failed} of ${result.candidatesExamined} examined guests`);
    }

    return {
      ok: true,
      batchSize: request.batchSize,
      maxPages: request.maxPages,
      inactivityThresholdDays: result.inactivityThresholdDays,
      inactiveBefore: result.inactiveBefore,
      pagesScanned: result.pagesScanned,
      candidatesExamined: result.candidatesExamined,
      deleted: result.deleted,
      skipped: result.skipped,
      skippedWorkspaceHasContent: result.skippedWorkspaceHasContent,
      skippedWorkspaceNotSoleOwned: result.skippedWorkspaceNotSoleOwned,
      skippedWorkspaceMissing: result.skippedWorkspaceMissing,
      skippedNoLongerCandidate: result.skippedNoLongerCandidate,
      interrupted: result.interrupted,
      failed: result.failed,
      finished: result.finished,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "web_guest_reaper_failed",
      error: normalizedError,
      scope: observationScope,
      details: createFailureDetails(request, normalizedError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(webGuestReaperHandler);
