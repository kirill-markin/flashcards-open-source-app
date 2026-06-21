import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import type { AuthTransport } from "../../auth";
import {
  createAnonymousDisplayName,
  ensurePublicProfileForCurrentUserInExecutor,
} from "../publicProfiles";
import { getAnonymousDisplayNameWordPools } from "../anonymousDisplayNames";
import { STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION } from "./streakLeaderboardSnapshots";
import {
  LEADERBOARD_SNAPSHOT_METRIC_VERSION,
  resolveBestLeaderboardPlacement,
  assertLeaderboardWindowKey,
  type LeaderboardBestPlacement,
  type LeaderboardWindowKey,
} from "./leaderboardWindows";

const LEADERBOARD_PROFILE_ACTIVITY_DAY_COUNT = 30;
const LEADERBOARD_PROFILE_REVIEW_ACTIVITY_DATE_BASIS = "profile_local_day_with_utc_fallback" as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export const LEADERBOARD_PROFILE_STATUSES = [
  "ready",
  "linked_account_required",
  "participation_disabled",
  "profile_unavailable",
] as const;

export type LeaderboardProfileStatus = (typeof LEADERBOARD_PROFILE_STATUSES)[number];
export type LeaderboardProfileNonReadyStatus = Exclude<LeaderboardProfileStatus, "ready">;

export type LeaderboardProfileMetrics = Readonly<{
  currentStreakDays: number;
  bestRatingPlacement: LeaderboardBestPlacement | null;
}>;

export type LeaderboardProfileReviewActivityDay = Readonly<{
  date: string;
  reviewCount: number;
}>;

export type LeaderboardProfileReviewActivity = Readonly<{
  dateBasis: typeof LEADERBOARD_PROFILE_REVIEW_ACTIVITY_DATE_BASIS;
  days: ReadonlyArray<LeaderboardProfileReviewActivityDay>;
}>;

export type LeaderboardProfileStats = Readonly<{
  joinedAt: string;
  totalCards: number;
}>;

export type LeaderboardProfileReady = Readonly<{
  status: "ready";
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  isFriend: boolean;
  metrics: LeaderboardProfileMetrics;
  reviewActivity: LeaderboardProfileReviewActivity;
  stats: LeaderboardProfileStats;
  generatedAt: string;
}>;

export type LeaderboardProfileNonReady = Readonly<{
  status: LeaderboardProfileNonReadyStatus;
}>;

export type LeaderboardProfile = LeaderboardProfileReady | LeaderboardProfileNonReady;

export type LeaderboardProfileRequest = Readonly<{
  userId: string;
  transport: AuthTransport;
  localeHint: string;
  publicProfileId: string;
}>;

type LeaderboardProfileSummaryRow = Readonly<{
  public_profile_id: string;
  joined_at: Date | string;
  total_cards: number | string;
  activity_date: string;
  review_count: number | string;
}>;

type LeaderboardProfileRatingPlacementRow = Readonly<{
  window_key: string;
  rank: number | string;
}>;

type LeaderboardProfileStreakRow = Readonly<{
  streak_days: number | string;
}>;

type LeaderboardProfileFriendDisplayNameRow = Readonly<{
  friend_public_profile_id: string;
  friend_display_name: string;
}>;

type LeaderboardProfileSummary = Readonly<{
  publicProfileId: string;
  joinedAt: string;
  totalCards: number;
  reviewActivityDays: ReadonlyArray<LeaderboardProfileReviewActivityDay>;
}>;

function buildNonReadyLeaderboardProfile(status: LeaderboardProfileNonReadyStatus): LeaderboardProfileNonReady {
  return { status };
}

function assertLeaderboardProfileReadTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "none") {
    throw new Error(
      `Leaderboard profile read requires a signed-in human transport, received ${transport}.`,
    );
  }
}

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function normalizeTimestamp(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid leaderboard profile timestamp for ${field}: ${String(value)}`);
  }

  return date.toISOString();
}

function normalizeLocalDate(value: string, field: string): string {
  if (!localDatePattern.test(value)) {
    throw new Error(`Invalid leaderboard profile local date for ${field}: ${value}`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid leaderboard profile local date for ${field}: ${value}`);
  }

  return value;
}

function normalizeNonNegativeInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer for ${field}: ${String(value)}`);
  }

  return parsed;
}

function normalizePositiveInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid positive integer for ${field}: ${String(value)}`);
  }

  return parsed;
}

function normalizeFriendDisplayName(value: string, publicProfileId: string): string {
  const displayNameLength = Array.from(value.trim()).length;
  if (displayNameLength < 1 || displayNameLength > 30 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error(`Invalid friend display name for public profile ${publicProfileId}.`);
  }

  return value;
}

function addUtcDays(localDate: string, dayCount: number): string {
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + dayCount);
  return parsed.toISOString().slice(0, 10);
}

function assertContiguousActivityDays(days: ReadonlyArray<LeaderboardProfileReviewActivityDay>): void {
  if (days.length !== LEADERBOARD_PROFILE_ACTIVITY_DAY_COUNT) {
    throw new Error(
      `Leaderboard profile review activity must contain ${LEADERBOARD_PROFILE_ACTIVITY_DAY_COUNT} days, got ${days.length}.`,
    );
  }

  days.forEach((day, index) => {
    if (index === 0) {
      return;
    }

    const previousDay = days[index - 1];
    if (previousDay === undefined) {
      throw new Error(`Missing leaderboard profile review activity day before index ${index}.`);
    }

    const expectedDate = addUtcDays(previousDay.date, 1);
    if (day.date !== expectedDate) {
      throw new Error(
        `Leaderboard profile review activity dates must be contiguous: expected ${expectedDate}, got ${day.date}.`,
      );
    }
  });
}

function mapLeaderboardProfileSummaryRows(
  rows: ReadonlyArray<LeaderboardProfileSummaryRow>,
): LeaderboardProfileSummary | null {
  const firstRow = rows[0];
  if (firstRow === undefined) {
    return null;
  }

  const publicProfileId = firstRow.public_profile_id;
  const joinedAt = normalizeTimestamp(firstRow.joined_at, "joined_at");
  const totalCards = normalizeNonNegativeInteger(firstRow.total_cards, "total_cards");
  const reviewActivityDays = rows.map((row) => {
    if (row.public_profile_id !== publicProfileId) {
      throw new Error("Leaderboard profile summary returned multiple public profile ids.");
    }

    const rowJoinedAt = normalizeTimestamp(row.joined_at, "joined_at");
    if (rowJoinedAt !== joinedAt) {
      throw new Error("Leaderboard profile summary returned inconsistent joined_at values.");
    }

    const rowTotalCards = normalizeNonNegativeInteger(row.total_cards, "total_cards");
    if (rowTotalCards !== totalCards) {
      throw new Error("Leaderboard profile summary returned inconsistent total_cards values.");
    }

    return {
      date: normalizeLocalDate(row.activity_date, "activity_date"),
      reviewCount: normalizeNonNegativeInteger(row.review_count, "review_count"),
    };
  });

  assertContiguousActivityDays(reviewActivityDays);

  return {
    publicProfileId,
    joinedAt,
    totalCards,
    reviewActivityDays,
  };
}

async function readLeaderboardProfileSummaryInExecutor(
  executor: DatabaseExecutor,
  publicProfileId: string,
  generatedAt: Date,
): Promise<LeaderboardProfileSummary | null> {
  const result = await executor.query<LeaderboardProfileSummaryRow>(
    [
      "SELECT",
      "profile_summary.public_profile_id::text AS public_profile_id,",
      "profile_summary.joined_at AS joined_at,",
      "profile_summary.total_cards AS total_cards,",
      "profile_summary.activity_date AS activity_date,",
      "profile_summary.review_count AS review_count",
      "FROM community.read_leaderboard_profile_summary($1::uuid, $2, $3, $4::timestamptz) AS profile_summary",
    ].join(" "),
    [
      publicProfileId,
      LEADERBOARD_SNAPSHOT_METRIC_VERSION,
      STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
      generatedAt,
    ],
  );

  return mapLeaderboardProfileSummaryRows(result.rows);
}

async function readTargetCurrentStreakDaysInExecutor(
  executor: DatabaseExecutor,
  publicProfileId: string,
): Promise<number> {
  const result = await executor.query<LeaderboardProfileStreakRow>(
    [
      "WITH latest_snapshot AS (",
      "SELECT snapshots.snapshot_id",
      "FROM community.streak_leaderboard_snapshots AS snapshots",
      "WHERE snapshots.metric_version = $1",
      "ORDER BY snapshots.as_of_utc_date DESC",
      "LIMIT 1",
      ")",
      "SELECT entries.streak_days AS streak_days",
      "FROM latest_snapshot",
      "INNER JOIN community.streak_leaderboard_snapshot_entries AS entries",
      "ON entries.snapshot_id = latest_snapshot.snapshot_id",
      "WHERE entries.public_profile_id = $2::uuid",
      "LIMIT 1",
    ].join(" "),
    [STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION, publicProfileId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return 0;
  }

  return normalizeNonNegativeInteger(row.streak_days, "streak_days");
}

async function readTargetBestRatingPlacementInExecutor(
  executor: DatabaseExecutor,
  publicProfileId: string,
): Promise<LeaderboardBestPlacement | null> {
  const result = await executor.query<LeaderboardProfileRatingPlacementRow>(
    [
      "WITH latest_snapshots AS (",
      "SELECT DISTINCT ON (snapshots.window_key)",
      "snapshots.window_key,",
      "snapshots.snapshot_id",
      "FROM community.leaderboard_snapshots AS snapshots",
      "WHERE snapshots.metric_version = $1",
      "ORDER BY snapshots.window_key, snapshots.as_of_server_hour DESC",
      ")",
      "SELECT",
      "latest_snapshots.window_key AS window_key,",
      "entries.base_sort_position AS rank",
      "FROM latest_snapshots",
      "INNER JOIN community.leaderboard_snapshot_entries AS entries",
      "ON entries.snapshot_id = latest_snapshots.snapshot_id",
      "WHERE entries.public_profile_id = $2::uuid",
      "ORDER BY latest_snapshots.window_key",
    ].join(" "),
    [LEADERBOARD_SNAPSHOT_METRIC_VERSION, publicProfileId],
  );

  return resolveBestLeaderboardPlacement(
    result.rows.map((row) => ({
      windowKey: assertLeaderboardWindowKey(row.window_key) satisfies LeaderboardWindowKey,
      rank: normalizePositiveInteger(row.rank, "rank"),
    })),
  );
}

async function readViewerFriendDisplayNamesInExecutor(
  executor: DatabaseExecutor,
): Promise<ReadonlyMap<string, string>> {
  const result = await executor.query<LeaderboardProfileFriendDisplayNameRow>(
    [
      "SELECT",
      "friend_labels.friend_public_profile_id::text AS friend_public_profile_id,",
      "friend_labels.friend_display_name AS friend_display_name",
      "FROM community.read_current_user_leaderboard_friend_labels() AS friend_labels",
      "ORDER BY friend_labels.friend_public_profile_id",
    ].join(" "),
    [],
  );

  const friendDisplayNamesByPublicProfileId = new Map<string, string>();
  for (const row of result.rows) {
    friendDisplayNamesByPublicProfileId.set(
      row.friend_public_profile_id,
      normalizeFriendDisplayName(row.friend_display_name, row.friend_public_profile_id),
    );
  }

  return friendDisplayNamesByPublicProfileId;
}

export async function loadLeaderboardProfileInExecutor(
  executor: DatabaseExecutor,
  request: LeaderboardProfileRequest,
  generatedAt: Date,
): Promise<LeaderboardProfile> {
  assertLeaderboardProfileReadTransport(request.transport);

  if (!isUuid(request.publicProfileId)) {
    return buildNonReadyLeaderboardProfile("profile_unavailable");
  }

  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });

  const viewerProfile = await ensurePublicProfileForCurrentUserInExecutor(executor);
  if (!viewerProfile.leaderboardParticipationEnabled) {
    return buildNonReadyLeaderboardProfile("participation_disabled");
  }

  const summary = await readLeaderboardProfileSummaryInExecutor(
    executor,
    request.publicProfileId,
    generatedAt,
  );
  if (summary === null) {
    return buildNonReadyLeaderboardProfile("profile_unavailable");
  }

  const friendDisplayNamesByPublicProfileId = await readViewerFriendDisplayNamesInExecutor(executor);
  const friendDisplayName = friendDisplayNamesByPublicProfileId.get(summary.publicProfileId);
  const wordPools = getAnonymousDisplayNameWordPools(request.localeHint);
  const currentStreakDays = await readTargetCurrentStreakDaysInExecutor(executor, summary.publicProfileId);
  const bestRatingPlacement = await readTargetBestRatingPlacementInExecutor(executor, summary.publicProfileId);

  return {
    status: "ready",
    publicProfileId: summary.publicProfileId,
    anonymousDisplayName: createAnonymousDisplayName(summary.publicProfileId, wordPools),
    ...(friendDisplayName === undefined ? {} : { friendDisplayName }),
    isFriend: friendDisplayName !== undefined,
    metrics: {
      currentStreakDays,
      bestRatingPlacement,
    },
    reviewActivity: {
      dateBasis: LEADERBOARD_PROFILE_REVIEW_ACTIVITY_DATE_BASIS,
      days: summary.reviewActivityDays,
    },
    stats: {
      joinedAt: summary.joinedAt,
      totalCards: summary.totalCards,
    },
    generatedAt: generatedAt.toISOString(),
  };
}

export async function loadLeaderboardProfile(
  request: LeaderboardProfileRequest,
): Promise<LeaderboardProfile> {
  if (request.transport === "guest") {
    return buildNonReadyLeaderboardProfile("linked_account_required");
  }

  return unsafeTransaction(
    async (executor) => loadLeaderboardProfileInExecutor(executor, request, new Date()),
  );
}
