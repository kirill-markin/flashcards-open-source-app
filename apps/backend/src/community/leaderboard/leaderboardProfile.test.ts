import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  loadLeaderboardProfile,
  loadLeaderboardProfileInExecutor,
  type LeaderboardProfile,
} from "./leaderboardProfile";

type QueryResultRow = pg.QueryResultRow;

type ViewerProfileFixture = Readonly<{
  publicProfileId: string;
  leaderboardParticipationEnabled: boolean;
}>;

type SummaryRowFixture = Readonly<{
  public_profile_id: string;
  joined_at: Date;
  total_cards: number;
  activity_date: string;
  review_count: number;
}>;

type RatingPlacementFixture = Readonly<{
  window_key: string;
  rank: number;
}>;

type FriendshipFixture = Readonly<{
  friendPublicProfileId: string;
  friendDisplayName: string;
}>;

type LeaderboardProfileExecutorFixture = Readonly<{
  viewerUserId: string;
  viewerProfile: ViewerProfileFixture;
  summaryRows: ReadonlyArray<SummaryRowFixture>;
  streakDays: number | null;
  ratingPlacements: ReadonlyArray<RatingPlacementFixture>;
  friendships: ReadonlyArray<FriendshipFixture>;
}>;

type RecordedQuery = Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>;

const VIEWER_USER_ID = "user-viewer";
const VIEWER_PROFILE_ID = "00000000-0000-4000-8000-0000000000a1";
const TARGET_PROFILE_ID = "00000000-0000-4000-8000-0000000000b2";
const GENERATED_AT = new Date("2026-06-21T12:34:56.000Z");
const JOINED_AT = new Date("2026-05-01T10:00:00.000Z");

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function includesQuery(recordedQueries: ReadonlyArray<RecordedQuery>, substring: string): boolean {
  return recordedQueries.some((query) => query.text.includes(substring));
}

function createSummaryRows(
  publicProfileId: string,
  joinedAt: Date,
  totalCards: number,
  reviewCountsByDate: Readonly<Record<string, number>>,
): ReadonlyArray<SummaryRowFixture> {
  const firstDate = new Date("2026-05-23T00:00:00.000Z");
  return Array.from({ length: 30 }, (_value, index) => {
    const activityDate = new Date(firstDate);
    activityDate.setUTCDate(firstDate.getUTCDate() + index);
    const localDate = activityDate.toISOString().slice(0, 10);

    return {
      public_profile_id: publicProfileId,
      joined_at: joinedAt,
      total_cards: totalCards,
      activity_date: localDate,
      review_count: reviewCountsByDate[localDate] ?? 0,
    };
  });
}

function assertReadyProfile(profile: LeaderboardProfile): asserts profile is Extract<LeaderboardProfile, { status: "ready" }> {
  assert.equal(profile.status, "ready");
}

function createLeaderboardProfileExecutor(
  fixture: LeaderboardProfileExecutorFixture,
): Readonly<{ executor: DatabaseExecutor; recordedQueries: ReadonlyArray<RecordedQuery> }> {
  const recordedQueries: Array<RecordedQuery> = [];
  let scopedUserId: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id', $1, true)")) {
        scopedUserId = typeof params[0] === "string" ? params[0] : null;
        return createQueryResult<QueryResultRow>([]) as pg.QueryResult<Row>;
      }

      if (text.includes("security.current_user_id() AS user_id")) {
        if (scopedUserId !== fixture.viewerUserId) {
          throw new Error("current_user_id read requires the viewer user scope");
        }

        return createQueryResult([{ user_id: fixture.viewerUserId }]) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.includes("FROM community.public_profiles")
        && text.includes("leaderboard_participation_enabled")
        && text.includes("WHERE user_id = $1")
        && !text.includes("INSERT")
      ) {
        if (scopedUserId !== fixture.viewerUserId) {
          throw new Error("public profile read requires the viewer user scope");
        }

        return createQueryResult([
          {
            public_profile_id: fixture.viewerProfile.publicProfileId,
            leaderboard_participation_enabled: fixture.viewerProfile.leaderboardParticipationEnabled,
          },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("INSERT INTO community.public_profiles")) {
        throw new Error("viewer profile was pre-seeded; no insert expected");
      }

      if (text.includes("FROM community.read_leaderboard_profile_summary(")) {
        if (scopedUserId !== fixture.viewerUserId) {
          throw new Error("profile summary read requires the viewer user scope");
        }
        assert.equal(params[1], "qualified_reviews_v1");
        assert.equal(params[2], "streak_days_v1");
        assert.equal(params[3], GENERATED_AT);
        for (const internalField of [
          "user_id",
          "email",
          "workspace_id",
          "card_id",
          "reviewed_at_client",
          "reviewed_at_server",
          "time_zone",
        ]) {
          assert.equal(text.includes(internalField), false, `summary service query must not select ${internalField}`);
        }

        return createQueryResult(fixture.summaryRows) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("FROM community.read_current_user_leaderboard_friend_labels() AS friend_labels")) {
        if (scopedUserId !== fixture.viewerUserId) {
          throw new Error("friend label read requires the viewer user scope");
        }

        return createQueryResult(
          fixture.friendships.map((friendship) => ({
            friend_public_profile_id: friendship.friendPublicProfileId,
            friend_display_name: friendship.friendDisplayName,
          })),
        ) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("community.streak_leaderboard_snapshot_entries AS entries")) {
        if (fixture.streakDays === null) {
          return createQueryResult([]) as unknown as pg.QueryResult<Row>;
        }

        return createQueryResult([{ streak_days: fixture.streakDays }]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("community.leaderboard_snapshot_entries AS entries")) {
        return createQueryResult(fixture.ratingPlacements) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected leaderboard profile read query: ${text}`);
    },
  };

  return { executor, recordedQueries };
}

test("guest viewers receive linked_account_required with no database access", async () => {
  const profile = await loadLeaderboardProfile({
    userId: VIEWER_USER_ID,
    transport: "guest",
    localeHint: "en",
    publicProfileId: TARGET_PROFILE_ID,
  });

  assert.deepEqual(profile, { status: "linked_account_required" });
});

test("opted-out viewers receive participation_disabled without target aggregate reads", async () => {
  const { executor, recordedQueries } = createLeaderboardProfileExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: false },
    summaryRows: createSummaryRows(TARGET_PROFILE_ID, JOINED_AT, 12, {}),
    streakDays: 4,
    ratingPlacements: [],
    friendships: [],
  });

  const profile = await loadLeaderboardProfileInExecutor(
    executor,
    {
      userId: VIEWER_USER_ID,
      transport: "session",
      localeHint: "en",
      publicProfileId: TARGET_PROFILE_ID,
    },
    GENERATED_AT,
  );

  assert.deepEqual(profile, { status: "participation_disabled" });
  assert.equal(includesQuery(recordedQueries, "community.read_leaderboard_profile_summary"), false);
  assert.equal(includesQuery(recordedQueries, "community.leaderboard_snapshot_entries AS entries"), false);
});

test("ineligible target profiles return profile_unavailable without metric reads", async () => {
  const { executor, recordedQueries } = createLeaderboardProfileExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    summaryRows: [],
    streakDays: 4,
    ratingPlacements: [
      { window_key: "last_24_hours", rank: 1 },
    ],
    friendships: [],
  });

  const profile = await loadLeaderboardProfileInExecutor(
    executor,
    {
      userId: VIEWER_USER_ID,
      transport: "bearer",
      localeHint: "en",
      publicProfileId: TARGET_PROFILE_ID,
    },
    GENERATED_AT,
  );

  assert.deepEqual(profile, { status: "profile_unavailable" });
  assert.equal(includesQuery(recordedQueries, "community.streak_leaderboard_snapshot_entries"), false);
  assert.equal(includesQuery(recordedQueries, "community.read_current_user_leaderboard_friend_labels"), false);
});

test("ready profile is privacy-limited and includes day activity, friend label, and best placement", async () => {
  const { executor } = createLeaderboardProfileExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    summaryRows: createSummaryRows(TARGET_PROFILE_ID, JOINED_AT, 72, {
      "2026-05-23": 2,
      "2026-06-01": 5,
      "2026-06-21": 1,
    }),
    streakDays: 9,
    ratingPlacements: [
      { window_key: "last_24_hours", rank: 8 },
      { window_key: "last_3_days", rank: 4 },
      { window_key: "last_7_days", rank: 4 },
      { window_key: "last_30_days", rank: 6 },
      { window_key: "all_time", rank: 2 },
    ],
    friendships: [
      { friendPublicProfileId: TARGET_PROFILE_ID, friendDisplayName: "Pat" },
    ],
  });

  const profile = await loadLeaderboardProfileInExecutor(
    executor,
    {
      userId: VIEWER_USER_ID,
      transport: "session",
      localeHint: "en",
      publicProfileId: TARGET_PROFILE_ID,
    },
    GENERATED_AT,
  );

  assertReadyProfile(profile);
  assert.equal(profile.publicProfileId, TARGET_PROFILE_ID);
  assert.equal(profile.friendDisplayName, "Pat");
  assert.equal(profile.isFriend, true);
  assert.equal(profile.metrics.currentStreakDays, 9);
  assert.deepEqual(profile.metrics.bestRatingPlacement, {
    windowKey: "all_time",
    rank: 2,
  });
  assert.equal(profile.reviewActivity.dateBasis, "profile_local_day_with_utc_fallback");
  assert.equal(profile.reviewActivity.days.length, 30);
  assert.deepEqual(profile.reviewActivity.days[0], { date: "2026-05-23", reviewCount: 2 });
  assert.deepEqual(profile.reviewActivity.days[9], { date: "2026-06-01", reviewCount: 5 });
  assert.deepEqual(profile.reviewActivity.days[29], { date: "2026-06-21", reviewCount: 1 });
  assert.deepEqual(profile.stats, {
    joinedAt: "2026-05-01T10:00:00.000Z",
    totalCards: 72,
  });
  assert.equal(profile.generatedAt, "2026-06-21T12:34:56.000Z");

  const serialized = JSON.stringify(profile);
  for (const internalField of [
    "userId",
    "workspaceId",
    "cardId",
    "email",
    "timeZone",
    "reviewedAt",
    "reviewed_at",
  ]) {
    assert.equal(serialized.includes(internalField), false, `profile response must not expose ${internalField}`);
  }
});

test("best rating placement ties prefer the shorter leaderboard window", async () => {
  const { executor } = createLeaderboardProfileExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    summaryRows: createSummaryRows(TARGET_PROFILE_ID, JOINED_AT, 10, {}),
    streakDays: null,
    ratingPlacements: [
      { window_key: "last_24_hours", rank: 7 },
      { window_key: "last_3_days", rank: 3 },
      { window_key: "last_7_days", rank: 3 },
      { window_key: "last_30_days", rank: 3 },
      { window_key: "all_time", rank: 9 },
    ],
    friendships: [],
  });

  const profile = await loadLeaderboardProfileInExecutor(
    executor,
    {
      userId: VIEWER_USER_ID,
      transport: "none",
      localeHint: "en",
      publicProfileId: TARGET_PROFILE_ID,
    },
    GENERATED_AT,
  );

  assertReadyProfile(profile);
  assert.equal("friendDisplayName" in profile, false);
  assert.equal(profile.isFriend, false);
  assert.equal(profile.metrics.currentStreakDays, 0);
  assert.deepEqual(profile.metrics.bestRatingPlacement, {
    windowKey: "last_3_days",
    rank: 3,
  });
});
