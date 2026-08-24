import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../../database";
import { listUserWorkspaceIdsInExecutor } from "../../../workspaces/queries";
import {
  loadUserActiveReviewLocalDatesInExecutor,
  rememberProgressTimeZoneInExecutor,
} from "../../activeReviewDays/activeReviewDays";
import {
  evaluateStreakFreeze,
  streakFreezePolicy,
  type StreakFreeze,
} from "../../streakFreeze";
import { formatDateAsTimeZoneLocalDate } from "../../timeZone";
import type {
  ProgressReviewHistoryWatermark,
  ProgressSummary,
  ProgressSummaryRequest,
  ProgressSummaryResponse,
} from "../contracts";
import {
  loadReviewHistoryWatermarksInExecutor,
  sortReviewHistoryWatermarks,
} from "./shared";

function createProgressSummary(
  activeReviewDayCount: number,
  currentStreakDays: number,
  longestStreakDays: number,
  hasReviewedToday: boolean,
  lastReviewedOn: string | null,
  streakFreeze: StreakFreeze,
): ProgressSummary {
  return {
    currentStreakDays,
    longestStreakDays,
    hasReviewedToday,
    lastReviewedOn,
    activeReviewDays: activeReviewDayCount,
    streakFreeze,
  };
}

async function buildUserProgressSummaryInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSummaryRequest,
  generatedAtDate: Date,
): Promise<ProgressSummaryResponse> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  // Personal Progress active streak days are user-wide materialized days.
  // The workspace loop only bounds raw review_event and watermark reads by RLS.
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);
  await rememberProgressTimeZoneInExecutor(executor, request.userId, request.timeZone);
  let reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark> = [];

  for (const workspaceId of workspaceIds) {
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: request.userId,
      workspaceId,
    });
    reviewHistoryWatermarks = reviewHistoryWatermarks.concat(
      await loadReviewHistoryWatermarksInExecutor(executor, [workspaceId]),
    );
  }

  // Active-day materialization is owned by review writes and the scheduled
  // backfill; progress reads intentionally do not repair historical rows.
  const activeReviewLocalDates = await loadUserActiveReviewLocalDatesInExecutor(executor, request.userId);
  const activeReviewDateSet = new Set(activeReviewLocalDates);
  const lastReviewedOn = activeReviewLocalDates.at(-1) ?? null;
  const today = formatDateAsTimeZoneLocalDate(generatedAtDate, request.timeZone);
  // Future-dated rows can appear when a client clock is ahead, so today must
  // be checked against the full normalized date set instead of the latest date.
  const hasReviewedToday = activeReviewDateSet.has(today);
  const streakFreezeEvaluation = evaluateStreakFreeze(
    activeReviewLocalDates,
    today,
    streakFreezePolicy,
  );

  return {
    timeZone: request.timeZone,
    summary: createProgressSummary(
      activeReviewLocalDates.length,
      streakFreezeEvaluation.currentStreakDays,
      streakFreezeEvaluation.longestStreakDays,
      hasReviewedToday,
      lastReviewedOn,
      streakFreezeEvaluation.streakFreeze,
    ),
    generatedAt: generatedAtDate.toISOString(),
    reviewHistoryWatermarks: sortReviewHistoryWatermarks(reviewHistoryWatermarks),
  };
}

export async function loadUserProgressSummaryInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSummaryRequest,
): Promise<ProgressSummaryResponse> {
  return buildUserProgressSummaryInExecutor(executor, request, new Date());
}
