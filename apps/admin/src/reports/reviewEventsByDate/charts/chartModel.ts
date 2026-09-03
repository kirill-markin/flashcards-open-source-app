import * as d3 from "d3";
import {
  reviewEventPlatforms,
  type ReviewEventPlatform,
  type ReviewEventsByDateCommunityRow,
  type ReviewEventsByDateReport,
  type ReviewEventsByDateUniqueUserCohort,
} from "../../../adminApi";
import { createTickDates, type MatrixChartEntry } from "../../../charts/chartPrimitives";

type DailyValueEntry = Readonly<{
  date: string;
  value: number;
}>;

export type ReviewEventsByDateChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  userIds: ReadonlyArray<string>;
  dailyUniqueUserCohortMatrix: ReadonlyArray<MatrixChartEntry>;
  friendInvitationUserIds: ReadonlyArray<string>;
  friendshipUserIds: ReadonlyArray<string>;
  friendInvitationUserMatrix: ReadonlyArray<MatrixChartEntry>;
  friendshipUserMatrix: ReadonlyArray<MatrixChartEntry>;
  friendInvitationTotalsByUserId: ReadonlyMap<string, number>;
  userMatrix: ReadonlyArray<MatrixChartEntry>;
  platformActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  platformReviewEventsMatrix: ReadonlyArray<MatrixChartEntry>;
  totalReviewEventsByDate: ReadonlyMap<string, number>;
  dailyUniqueUsersByDate: ReadonlyMap<string, number>;
  totalPlatformReviewEventsByDate: ReadonlyMap<string, number>;
  totalFriendInvitationsByDate: ReadonlyMap<string, number>;
  totalFriendshipsByDate: ReadonlyMap<string, number>;
  peakDailyUniqueUsers: number;
  peakDailyFriendInvitations: number;
  peakDailyFriendships: number;
  peakDailyVolume: number;
  peakDailyPlatformUsers: number;
  peakDailyPlatformReviewEvents: number;
}>;

export function buildReviewEventsByDateChartModel(
  report: ReviewEventsByDateReport,
): ReviewEventsByDateChartModel {
  const dates = report.dateTotals.map((item) => item.date);
  const tickDates = createTickDates(dates);
  const userIds = report.users.map((user) => user.userId);
  const dailyUniqueUserCohortMatrix = buildDailyUniqueUserCohortMatrix(report.dailyUniqueUserCohorts);
  const dailyUniqueUserTotals = report.dailyUniqueUserCohorts.map((item) => ({
    date: item.date,
    value: item.newReviewingUsers + item.returningReviewingUsers,
  }));
  const friendInvitationTotalsByUserId = buildCommunityTotalsByUserId(
    report.communityRows,
    (row) => row.friendInvitationCount,
  );
  const friendshipTotalsByUserId = buildCommunityTotalsByUserId(
    report.communityRows,
    (row) => row.friendshipCount,
  );
  const friendInvitationUserIds = buildCommunityUserIds(friendInvitationTotalsByUserId);
  const friendshipUserIds = buildCommunityUserIds(friendshipTotalsByUserId);
  const friendInvitationUserMatrix = buildCommunityUserMatrix(
    report.communityRows,
    (row) => row.friendInvitationCount,
    dates,
  );
  const friendshipUserMatrix = buildCommunityUserMatrix(
    report.communityRows,
    (row) => row.friendshipCount,
    dates,
  );
  const userMatrix = buildUserMatrix(report);
  const platformActiveUsersMatrix = buildPlatformMatrix(
    report.platformActiveUserTotals,
    (item) => item.activeUserCount,
    dates,
  );
  const platformReviewEventsMatrix = buildPlatformMatrix(
    report.platformReviewEventTotals,
    (item) => item.reviewEventCount,
    dates,
  );
  const totalReviewEventsByDate = new Map(report.dateTotals.map((item) => [item.date, item.totalReviewEvents]));
  const dailyUniqueUsersByDate = new Map(dailyUniqueUserTotals.map((item) => [item.date, item.value]));
  const totalPlatformReviewEventsByDate = buildTotalsByDate(platformReviewEventsMatrix);
  const totalFriendInvitationsByDate = buildTotalsByDate(friendInvitationUserMatrix);
  const totalFriendshipsByDate = buildTotalsByDate(friendshipUserMatrix);
  const peakDailyUniqueUsers = getPeakDailyValue(dailyUniqueUserTotals);
  const peakDailyFriendInvitations = getPeakStackedValue(friendInvitationUserMatrix);
  const peakDailyFriendships = getPeakStackedValue(friendshipUserMatrix);
  const peakDailyVolume = d3.max(report.dateTotals, (item) => item.totalReviewEvents) ?? 0;
  const peakDailyPlatformUsers = getPeakGroupedValue(platformActiveUsersMatrix);
  const peakDailyPlatformReviewEvents = getPeakStackedValue(platformReviewEventsMatrix);

  return {
    dates,
    tickDates,
    userIds,
    dailyUniqueUserCohortMatrix,
    friendInvitationUserIds,
    friendshipUserIds,
    friendInvitationUserMatrix,
    friendshipUserMatrix,
    friendInvitationTotalsByUserId,
    userMatrix,
    platformActiveUsersMatrix,
    platformReviewEventsMatrix,
    totalReviewEventsByDate,
    dailyUniqueUsersByDate,
    totalPlatformReviewEventsByDate,
    totalFriendInvitationsByDate,
    totalFriendshipsByDate,
    peakDailyUniqueUsers,
    peakDailyFriendInvitations,
    peakDailyFriendships,
    peakDailyVolume,
    peakDailyPlatformUsers,
    peakDailyPlatformReviewEvents,
  };
}

function buildDailyUniqueUserCohortMatrix(
  cohorts: ReadonlyArray<ReviewEventsByDateUniqueUserCohort>,
): ReadonlyArray<MatrixChartEntry> {
  return cohorts.map((cohort) => ({
    date: cohort.date,
    valuesByKey: {
      returning: cohort.returningReviewingUsers,
      new: cohort.newReviewingUsers,
    },
  }));
}

function buildCommunityTotalsByUserId(
  communityRows: ReadonlyArray<ReviewEventsByDateCommunityRow>,
  getValue: (row: ReviewEventsByDateCommunityRow) => number,
): ReadonlyMap<string, number> {
  const totalsByUserId = new Map<string, number>();

  for (const row of communityRows) {
    totalsByUserId.set(row.userId, (totalsByUserId.get(row.userId) ?? 0) + getValue(row));
  }

  return totalsByUserId;
}

/** Stack keys for a community chart, ordered by range total so the largest contributors sit at the bottom. */
function buildCommunityUserIds(totalsByUserId: ReadonlyMap<string, number>): ReadonlyArray<string> {
  return Array.from(totalsByUserId.entries())
    .filter(([, total]) => total > 0)
    .sort(([leftUserId, leftTotal], [rightUserId, rightTotal]) => {
      if (rightTotal !== leftTotal) {
        return rightTotal - leftTotal;
      }

      return leftUserId.localeCompare(rightUserId);
    })
    .map(([userId]) => userId);
}

function buildCommunityUserMatrix(
  communityRows: ReadonlyArray<ReviewEventsByDateCommunityRow>,
  getValue: (row: ReviewEventsByDateCommunityRow) => number,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const row of communityRows) {
    const currentValues = valuesByDate.get(row.date) ?? {};
    currentValues[row.userId] = (currentValues[row.userId] ?? 0) + getValue(row);
    valuesByDate.set(row.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

function buildUserMatrix(report: ReviewEventsByDateReport): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const row of report.rows) {
    const currentValues = valuesByDate.get(row.date) ?? {};
    currentValues[row.userId] = (currentValues[row.userId] ?? 0) + row.reviewEventCount;
    valuesByDate.set(row.date, currentValues);
  }

  return report.dateTotals.map((item) => ({
    date: item.date,
    valuesByKey: valuesByDate.get(item.date) ?? {},
  }));
}

function buildPlatformMatrix<Item extends Readonly<{ date: string; platform: ReviewEventPlatform }>>(
  items: ReadonlyArray<Item>,
  getValue: (item: Item) => number,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const item of items) {
    const currentValues = valuesByDate.get(item.date) ?? {};
    currentValues[item.platform] = getValue(item);
    valuesByDate.set(item.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

function buildTotalsByDate(items: ReadonlyArray<DailyValueEntry | MatrixChartEntry>): ReadonlyMap<string, number> {
  const totalsByDate = new Map<string, number>();

  for (const item of items) {
    if ("value" in item) {
      totalsByDate.set(item.date, item.value);
      continue;
    }

    const nextTotal = Object.values(item.valuesByKey).reduce((sum, value) => sum + value, 0);
    totalsByDate.set(item.date, nextTotal);
  }

  return totalsByDate;
}

function getPeakDailyValue(items: ReadonlyArray<DailyValueEntry>): number {
  return d3.max(items, (item) => item.value) ?? 0;
}

function getPeakStackedValue(items: ReadonlyArray<MatrixChartEntry>): number {
  return d3.max(items, (item) => Object.values(item.valuesByKey).reduce((sum, value) => sum + value, 0)) ?? 0;
}

function getPeakGroupedValue(items: ReadonlyArray<MatrixChartEntry>): number {
  return d3.max(items, (item) => d3.max(reviewEventPlatforms, (platform) => item.valuesByKey[platform] ?? 0) ?? 0) ?? 0;
}
