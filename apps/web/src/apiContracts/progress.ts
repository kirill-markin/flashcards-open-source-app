import type {
  ProgressLeaderboard,
  ProgressLeaderboardMetric,
  ProgressLeaderboardRankingRow,
  ProgressLeaderboardRow,
  ProgressLeaderboardViewer,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
  ProgressReviewHistoryWatermark,
  ProgressReviewSchedule,
  ProgressSeries,
  ProgressSummaryPayload,
} from "../types";
import {
  progressLeaderboardParticipantRowKinds,
  progressLeaderboardRankingRowKinds,
  progressLeaderboardStatuses,
  progressLeaderboardWindowKeys,
  progressReviewScheduleBucketKeys,
} from "../types";
import { findProgressReviewScheduleValidationIssue } from "../progress/progressReviewScheduleValidation";
import {
  ApiContractError,
  describePath,
  joinIndexPath,
  joinPath,
  type JsonObject,
  parseArray,
  parseBoolean,
  parseEnum,
  parseNullableString,
  parseNumber,
  parseObject,
  parseOptionalField,
  parseRequiredField,
  parseString,
} from "./core";

function parseNonNegativeSafeInteger(value: unknown, endpoint: string, path: string): number {
  const numberValue = parseNumber(value, endpoint, path);

  if (Number.isSafeInteger(numberValue) === false || numberValue < 0) {
    throw new ApiContractError(endpoint, describePath(path), "a non-negative safe integer");
  }

  return numberValue;
}

function parseDailyReviewPoint(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressSeries["dailyReviews"][number] {
  const objectValue = parseObject(value, endpoint, path);
  const dailyReviewPoint = {
    date: parseRequiredField(objectValue, "date", endpoint, path, parseString),
    reviewCount: parseRequiredField(objectValue, "reviewCount", endpoint, path, parseNonNegativeSafeInteger),
    againCount: parseRequiredField(objectValue, "againCount", endpoint, path, parseNonNegativeSafeInteger),
    hardCount: parseRequiredField(objectValue, "hardCount", endpoint, path, parseNonNegativeSafeInteger),
    goodCount: parseRequiredField(objectValue, "goodCount", endpoint, path, parseNonNegativeSafeInteger),
    easyCount: parseRequiredField(objectValue, "easyCount", endpoint, path, parseNonNegativeSafeInteger),
  };
  const ratingCountSum = dailyReviewPoint.againCount
    + dailyReviewPoint.hardCount
    + dailyReviewPoint.goodCount
    + dailyReviewPoint.easyCount;

  if (dailyReviewPoint.reviewCount !== ratingCountSum) {
    throw new ApiContractError(endpoint, describePath(joinPath(path, "reviewCount")), `rating count sum (${ratingCountSum})`);
  }

  return dailyReviewPoint;
}

function parseProgressReviewHistoryWatermarkSequenceId(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressReviewHistoryWatermark["reviewSequenceId"] {
  const reviewSequenceId = parseNumber(value, endpoint, path);

  if (Number.isSafeInteger(reviewSequenceId) === false || reviewSequenceId < 0) {
    throw new ApiContractError(endpoint, describePath(path), "a non-negative safe integer");
  }

  return reviewSequenceId;
}

function parseProgressReviewHistoryWatermark(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressReviewHistoryWatermark {
  const objectValue = parseObject(value, endpoint, path);
  return {
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    reviewSequenceId: parseRequiredField(
      objectValue,
      "reviewSequenceId",
      endpoint,
      path,
      parseProgressReviewHistoryWatermarkSequenceId,
    ),
  };
}

function parseProgressReviewScheduleBucketKey(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressReviewSchedule["buckets"][number]["key"] {
  return parseEnum(value, endpoint, path, progressReviewScheduleBucketKeys);
}

function parseProgressReviewScheduleBucket(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressReviewSchedule["buckets"][number] {
  const objectValue = parseObject(value, endpoint, path);
  return {
    key: parseRequiredField(objectValue, "key", endpoint, path, parseProgressReviewScheduleBucketKey),
    count: parseRequiredField(objectValue, "count", endpoint, path, parseNumber),
  };
}

function parseDailyReviewPointArray(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressSeries["dailyReviews"] {
  return parseArray(value, endpoint, path, parseDailyReviewPoint);
}

function parseProgressReviewHistoryWatermarkArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ProgressReviewHistoryWatermark> {
  return parseArray(value, endpoint, path, parseProgressReviewHistoryWatermark);
}

function parseOptionalProgressReviewHistoryWatermarkArray(
  objectValue: JsonObject,
  endpoint: string,
  parentPath: string,
): ReadonlyArray<ProgressReviewHistoryWatermark> {
  return parseOptionalField(
    objectValue,
    "reviewHistoryWatermarks",
    endpoint,
    parentPath,
    parseProgressReviewHistoryWatermarkArray,
  ) ?? [];
}

function parseProgressReviewScheduleBucketArray(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressReviewSchedule["buckets"] {
  return parseArray(value, endpoint, path, parseProgressReviewScheduleBucket);
}

function parseProgressSummary(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressSummaryPayload["summary"] {
  const objectValue = parseObject(value, endpoint, path);
  return {
    currentStreakDays: parseRequiredField(objectValue, "currentStreakDays", endpoint, path, parseNumber),
    hasReviewedToday: parseRequiredField(objectValue, "hasReviewedToday", endpoint, path, parseBoolean),
    lastReviewedOn: parseRequiredField(objectValue, "lastReviewedOn", endpoint, path, parseNullableString),
    activeReviewDays: parseRequiredField(objectValue, "activeReviewDays", endpoint, path, parseNumber),
  };
}

// Wire-shape note: the backend always emits `generatedAt` as a non-null ISO string for
// the progress summary, series, and review-schedule endpoints (see apps/backend/src/progress/index.ts).
// We therefore parse it strictly with `parseRequiredField(... parseString)` so a missing or
// null value fails loud with `ApiContractError` instead of being silently coerced to null,
// matching the project's "no fallbacks / fail loud" rule.
//
// The shared in-memory types (`ProgressSummaryPayload`, `ProgressSeries`,
// `ProgressReviewSchedule`) keep `generatedAt: string | null` because callers also
// construct local-only fallback snapshots (e.g. `localDb/reviews/reviewSchedule.ts`,
// `progressSnapshots.buildLocalFallbackSeries`) where there is no server timestamp;
// assigning a strictly-parsed `string` into the nullable field is type-safe.
export function parseProgressSeriesResponse(value: unknown, endpoint: string): ProgressSeries {
  const objectValue = parseObject(value, endpoint, "");
  return {
    timeZone: parseRequiredField(objectValue, "timeZone", endpoint, "", parseString),
    from: parseRequiredField(objectValue, "from", endpoint, "", parseString),
    to: parseRequiredField(objectValue, "to", endpoint, "", parseString),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    reviewHistoryWatermarks: parseOptionalProgressReviewHistoryWatermarkArray(
      objectValue,
      endpoint,
      "",
    ),
    dailyReviews: parseRequiredField(objectValue, "dailyReviews", endpoint, "", parseDailyReviewPointArray),
  };
}

export function parseProgressSummaryResponse(value: unknown, endpoint: string): ProgressSummaryPayload {
  const objectValue = parseObject(value, endpoint, "");

  return {
    timeZone: parseRequiredField(objectValue, "timeZone", endpoint, "", parseString),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    reviewHistoryWatermarks: parseOptionalProgressReviewHistoryWatermarkArray(
      objectValue,
      endpoint,
      "",
    ),
    summary: parseRequiredField(objectValue, "summary", endpoint, "", parseProgressSummary),
  };
}

function parseLeaderboardRank(value: unknown, endpoint: string, path: string): number {
  const rank = parseNonNegativeSafeInteger(value, endpoint, path);

  if (rank < 1) {
    throw new ApiContractError(endpoint, describePath(path), "a positive safe integer");
  }

  return rank;
}

function parseProgressLeaderboardWindowKey(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressLeaderboardWindowKey {
  return parseEnum(value, endpoint, path, progressLeaderboardWindowKeys);
}

function parseProgressLeaderboardMetric(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressLeaderboardMetric {
  const objectValue = parseObject(value, endpoint, path);
  return {
    metricVersion: parseEnum(objectValue.metricVersion, endpoint, joinPath(path, "metricVersion"), ["qualified_reviews_v1"] as const),
    title: parseRequiredField(objectValue, "title", endpoint, path, parseString),
    description: parseRequiredField(objectValue, "description", endpoint, path, parseString),
  };
}

function parseProgressLeaderboardViewer(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressLeaderboardViewer {
  const objectValue = parseObject(value, endpoint, path);
  return {
    publicProfileId: parseRequiredField(objectValue, "publicProfileId", endpoint, path, parseString),
    displayName: parseRequiredField(objectValue, "displayName", endpoint, path, parseString),
    rank: parseRequiredField(objectValue, "rank", endpoint, path, parseLeaderboardRank),
    qualifiedReviewCount: parseRequiredField(objectValue, "qualifiedReviewCount", endpoint, path, parseNonNegativeSafeInteger),
  };
}

function parseProgressLeaderboardRow(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressLeaderboardRow {
  const objectValue = parseObject(value, endpoint, path);

  if (objectValue.kind === "gap") {
    return { kind: "gap" };
  }

  return {
    kind: parseEnum(objectValue.kind, endpoint, joinPath(path, "kind"), progressLeaderboardParticipantRowKinds),
    publicProfileId: parseRequiredField(objectValue, "publicProfileId", endpoint, path, parseString),
    anonymousDisplayName: parseRequiredField(objectValue, "anonymousDisplayName", endpoint, path, parseString),
    friendDisplayName: parseOptionalField(objectValue, "friendDisplayName", endpoint, path, parseString),
    qualifiedReviewCount: parseRequiredField(objectValue, "qualifiedReviewCount", endpoint, path, parseNonNegativeSafeInteger),
    rank: parseRequiredField(objectValue, "rank", endpoint, path, parseLeaderboardRank),
  };
}

function parseProgressLeaderboardRowArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ProgressLeaderboardRow> {
  return parseArray(value, endpoint, path, parseProgressLeaderboardRow);
}

function parseProgressLeaderboardRankingRow(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressLeaderboardRankingRow {
  const objectValue = parseObject(value, endpoint, path);

  return {
    kind: parseEnum(objectValue.kind, endpoint, joinPath(path, "kind"), progressLeaderboardRankingRowKinds),
    publicProfileId: parseRequiredField(objectValue, "publicProfileId", endpoint, path, parseString),
    anonymousDisplayName: parseRequiredField(objectValue, "anonymousDisplayName", endpoint, path, parseString),
    friendDisplayName: parseOptionalField(objectValue, "friendDisplayName", endpoint, path, parseString),
    qualifiedReviewCount: parseRequiredField(objectValue, "qualifiedReviewCount", endpoint, path, parseNonNegativeSafeInteger),
    rank: parseRequiredField(objectValue, "rank", endpoint, path, parseLeaderboardRank),
  };
}

function parseProgressLeaderboardRankingRowArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ProgressLeaderboardRankingRow> {
  return parseArray(value, endpoint, path, parseProgressLeaderboardRankingRow);
}

function validateProgressLeaderboardRankingRows(
  participantCount: number,
  viewer: ProgressLeaderboardViewer,
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
  endpoint: string,
  path: string,
): void {
  const rankingRowsPath = joinPath(path, "rankingRows");

  if (rankingRows.length !== participantCount) {
    throw new ApiContractError(endpoint, describePath(rankingRowsPath), "one row per participant");
  }

  let viewerRowCount = 0;
  let previousQualifiedReviewCount: number | null = null;

  rankingRows.forEach((row, index) => {
    const rowPath = joinIndexPath(rankingRowsPath, index);

    if (row.rank !== index + 1) {
      throw new ApiContractError(endpoint, describePath(joinPath(rowPath, "rank")), "a contiguous rank matching array order");
    }

    if (previousQualifiedReviewCount !== null && row.qualifiedReviewCount > previousQualifiedReviewCount) {
      throw new ApiContractError(endpoint, describePath(joinPath(rowPath, "qualifiedReviewCount")), "non-increasing ranking order");
    }

    previousQualifiedReviewCount = row.qualifiedReviewCount;

    if (row.kind === "viewer") {
      viewerRowCount += 1;

      if (
        row.publicProfileId !== viewer.publicProfileId
        || row.rank !== viewer.rank
        || row.qualifiedReviewCount !== viewer.qualifiedReviewCount
      ) {
        throw new ApiContractError(endpoint, describePath(rowPath), "the current viewer row");
      }
    } else if (row.publicProfileId === viewer.publicProfileId) {
      throw new ApiContractError(endpoint, describePath(rowPath), "a non-viewer participant");
    }
  });

  if (viewerRowCount !== 1) {
    throw new ApiContractError(endpoint, describePath(rankingRowsPath), "exactly one current viewer row");
  }
}

function parseProgressLeaderboardWindow(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressLeaderboardWindow {
  const objectValue = parseObject(value, endpoint, path);
  const participantCount = parseRequiredField(objectValue, "participantCount", endpoint, path, parseNonNegativeSafeInteger);
  const viewer = parseRequiredField(objectValue, "viewer", endpoint, path, parseProgressLeaderboardViewer);
  const rankingRows = parseRequiredField(objectValue, "rankingRows", endpoint, path, parseProgressLeaderboardRankingRowArray);

  validateProgressLeaderboardRankingRows(participantCount, viewer, rankingRows, endpoint, path);

  return {
    windowKey: parseRequiredField(objectValue, "windowKey", endpoint, path, parseProgressLeaderboardWindowKey),
    snapshotId: parseRequiredField(objectValue, "snapshotId", endpoint, path, parseString),
    snapshotGeneratedAt: parseRequiredField(objectValue, "snapshotGeneratedAt", endpoint, path, parseString),
    asOfServerHour: parseRequiredField(objectValue, "asOfServerHour", endpoint, path, parseString),
    nextRefreshAfter: parseRequiredField(objectValue, "nextRefreshAfter", endpoint, path, parseString),
    participantCount,
    viewer,
    rows: parseRequiredField(objectValue, "rows", endpoint, path, parseProgressLeaderboardRowArray),
    rankingRows,
  };
}

function parseProgressLeaderboardWindowArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ProgressLeaderboardWindow> {
  return parseArray(value, endpoint, path, parseProgressLeaderboardWindow);
}

export function parseProgressLeaderboardResponse(value: unknown, endpoint: string): ProgressLeaderboard {
  const objectValue = parseObject(value, endpoint, "");
  return {
    status: parseEnum(objectValue.status, endpoint, "status", progressLeaderboardStatuses),
    metric: parseRequiredField(objectValue, "metric", endpoint, "", parseProgressLeaderboardMetric),
    defaultWindowKey: parseRequiredField(objectValue, "defaultWindowKey", endpoint, "", parseProgressLeaderboardWindowKey),
    windows: parseRequiredField(objectValue, "windows", endpoint, "", parseProgressLeaderboardWindowArray),
  };
}

export function parseProgressReviewScheduleResponse(value: unknown, endpoint: string): ProgressReviewSchedule {
  const objectValue = parseObject(value, endpoint, "");
  const schedule: ProgressReviewSchedule = {
    timeZone: parseRequiredField(objectValue, "timeZone", endpoint, "", parseString),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    reviewHistoryWatermarks: parseOptionalProgressReviewHistoryWatermarkArray(
      objectValue,
      endpoint,
      "",
    ),
    totalCards: parseRequiredField(objectValue, "totalCards", endpoint, "", parseNumber),
    buckets: parseRequiredField(objectValue, "buckets", endpoint, "", parseProgressReviewScheduleBucketArray),
  };
  const validationIssue = findProgressReviewScheduleValidationIssue(schedule, "");

  if (validationIssue !== null) {
    throw new ApiContractError(endpoint, describePath(validationIssue.path), validationIssue.expected);
  }

  return schedule;
}
