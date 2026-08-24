import { withTransientDatabaseRetry } from "../../database/transient";
import { unsafeRepeatableReadTransaction } from "../../database/unsafe";
import { createBackendRuntimeObservationScope } from "../../observability/sentry";
import type {
  ProgressReviewSchedule,
  ProgressReviewScheduleRequest,
  ProgressSeries,
  ProgressSeriesRequest,
  ProgressSummaryRequest,
  ProgressSummaryResponse,
} from "./contracts";
import {
  loadUserProgressReviewScheduleInExecutor,
  loadUserProgressSeriesInExecutor,
  loadUserProgressSummaryInExecutor,
} from "./loaders";

export {
  parseProgressReviewScheduleInputFromRequest,
  parseProgressSeriesInputFromRequest,
  parseProgressSummaryInputFromRequest,
  reviewScheduleBucketKeys,
  type DailyReviewPoint,
  type ProgressReviewHistoryWatermark,
  type ProgressReviewHistoryWatermarkPayload,
  type ProgressReviewSchedule,
  type ProgressReviewScheduleInput,
  type ProgressReviewScheduleRequest,
  type ProgressSeries,
  type ProgressSeriesInput,
  type ProgressSeriesRequest,
  type ProgressSummary,
  type ProgressSummaryInput,
  type ProgressSummaryRequest,
  type ProgressSummaryResponse,
  type ReviewScheduleBucket,
  type ReviewScheduleBucketKey,
} from "./contracts";
export {
  loadUserProgressReviewScheduleInExecutor,
  loadUserProgressSeriesInExecutor,
  loadUserProgressSummaryInExecutor,
};

export async function loadUserProgressSummary(request: ProgressSummaryRequest): Promise<ProgressSummaryResponse> {
  return withTransientDatabaseRetry(
    () => unsafeRepeatableReadTransaction(
      async (executor) => loadUserProgressSummaryInExecutor(executor, request),
    ),
    createBackendRuntimeObservationScope,
  );
}

export async function loadUserProgressReviewSchedule(
  request: ProgressReviewScheduleRequest,
): Promise<ProgressReviewSchedule> {
  return unsafeRepeatableReadTransaction(
    async (executor) => loadUserProgressReviewScheduleInExecutor(executor, request),
  );
}

export async function loadUserProgressSeries(request: ProgressSeriesRequest): Promise<ProgressSeries> {
  return withTransientDatabaseRetry(
    () => unsafeRepeatableReadTransaction(
      async (executor) => loadUserProgressSeriesInExecutor(executor, request),
    ),
    createBackendRuntimeObservationScope,
  );
}
