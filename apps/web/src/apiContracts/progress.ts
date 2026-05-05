import type {
  ProgressReviewSchedule,
  ProgressSeries,
  ProgressSummaryPayload,
} from "../types";
import { progressReviewScheduleBucketKeys } from "../types";
import { findProgressReviewScheduleValidationIssue } from "../progress/progressReviewScheduleValidation";
import {
  ApiContractError,
  describePath,
  parseArray,
  parseBoolean,
  parseEnum,
  parseNullableString,
  parseNumber,
  parseObject,
  parseRequiredField,
  parseString,
} from "./core";

function parseDailyReviewPoint(
  value: unknown,
  endpoint: string,
  path: string,
): ProgressSeries["dailyReviews"][number] {
  const objectValue = parseObject(value, endpoint, path);
  return {
    date: parseRequiredField(objectValue, "date", endpoint, path, parseString),
    reviewCount: parseRequiredField(objectValue, "reviewCount", endpoint, path, parseNumber),
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
// the progress summary, series, and review-schedule endpoints (see apps/backend/src/progress.ts).
// We therefore parse it strictly with `parseRequiredField(... parseString)` so a missing or
// null value fails loud with `ApiContractError` instead of being silently coerced to null,
// matching the project's "no fallbacks / fail loud" rule.
//
// The shared in-memory types (`ProgressSummaryPayload`, `ProgressSeries`,
// `ProgressReviewSchedule`) keep `generatedAt: string | null` because callers also
// construct local-only fallback snapshots (e.g. `localDb/reviewSchedule.ts`,
// `progressSnapshots.buildLocalFallbackSeries`) where there is no server timestamp;
// assigning a strictly-parsed `string` into the nullable field is type-safe.
export function parseProgressSeriesResponse(value: unknown, endpoint: string): ProgressSeries {
  const objectValue = parseObject(value, endpoint, "");
  return {
    timeZone: parseRequiredField(objectValue, "timeZone", endpoint, "", parseString),
    from: parseRequiredField(objectValue, "from", endpoint, "", parseString),
    to: parseRequiredField(objectValue, "to", endpoint, "", parseString),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    dailyReviews: parseRequiredField(objectValue, "dailyReviews", endpoint, "", parseDailyReviewPointArray),
  };
}

export function parseProgressSummaryResponse(value: unknown, endpoint: string): ProgressSummaryPayload {
  const objectValue = parseObject(value, endpoint, "");

  return {
    timeZone: parseRequiredField(objectValue, "timeZone", endpoint, "", parseString),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    summary: parseRequiredField(objectValue, "summary", endpoint, "", parseProgressSummary),
  };
}

export function parseProgressReviewScheduleResponse(value: unknown, endpoint: string): ProgressReviewSchedule {
  const objectValue = parseObject(value, endpoint, "");
  const schedule: ProgressReviewSchedule = {
    timeZone: parseRequiredField(objectValue, "timeZone", endpoint, "", parseString),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    totalCards: parseRequiredField(objectValue, "totalCards", endpoint, "", parseNumber),
    buckets: parseRequiredField(objectValue, "buckets", endpoint, "", parseProgressReviewScheduleBucketArray),
  };
  const validationIssue = findProgressReviewScheduleValidationIssue(schedule, "");

  if (validationIssue !== null) {
    throw new ApiContractError(endpoint, describePath(validationIssue.path), validationIssue.expected);
  }

  return schedule;
}
