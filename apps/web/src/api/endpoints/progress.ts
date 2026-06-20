import { ApiContractError } from "../../apiContracts/core";
import {
  parseProgressLeaderboardResponse,
  parseProgressReviewScheduleResponse,
  parseProgressSeriesResponse,
  parseProgressStreakLeaderboardResponse,
  parseProgressSummaryResponse,
} from "../../apiContracts/progress";
import type {
  ProgressLeaderboard,
  ProgressReviewSchedule,
  ProgressReviewScheduleInput,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressStreakLeaderboard,
  ProgressSummaryInput,
  ProgressSummaryPayload,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

export async function loadProgressSummary(input: ProgressSummaryInput): Promise<ProgressSummaryPayload> {
  const searchParams = new URLSearchParams({
    timeZone: input.timeZone,
  });

  return parseContractResponse(
    await requestJson(`/me/progress/summary?${searchParams.toString()}`, {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /me/progress/summary",
    parseProgressSummaryResponse,
  );
}

export async function loadProgressSeries(input: ProgressSeriesInput): Promise<ProgressSeries> {
  const searchParams = new URLSearchParams({
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
  });

  return parseContractResponse(
    await requestJson(`/me/progress/series?${searchParams.toString()}`, {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /me/progress/series",
    parseProgressSeriesResponse,
  );
}

export async function loadProgressLeaderboard(): Promise<ProgressLeaderboard> {
  return parseContractResponse(
    await requestJson("/me/progress/leaderboard", {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /me/progress/leaderboard",
    parseProgressLeaderboardResponse,
  );
}

export async function loadProgressStreakLeaderboard(): Promise<ProgressStreakLeaderboard> {
  return parseContractResponse(
    await requestJson("/me/progress/leaderboards/streak", {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /me/progress/leaderboards/streak",
    parseProgressStreakLeaderboardResponse,
  );
}

export async function loadProgressReviewSchedule(
  input: ProgressReviewScheduleInput,
): Promise<ProgressReviewSchedule> {
  const searchParams = new URLSearchParams({
    timeZone: input.timeZone,
  });
  const endpoint = "GET /me/progress/review-schedule";
  return parseContractResponse(
    await requestJson(`/me/progress/review-schedule?${searchParams.toString()}`, {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    endpoint,
    (value: unknown, parseEndpoint: string): ProgressReviewSchedule => {
      const schedule = parseProgressReviewScheduleResponse(value, parseEndpoint);
      if (schedule.timeZone !== input.timeZone) {
        throw new ApiContractError(parseEndpoint, "timeZone", JSON.stringify(input.timeZone));
      }

      return schedule;
    },
  );
}
