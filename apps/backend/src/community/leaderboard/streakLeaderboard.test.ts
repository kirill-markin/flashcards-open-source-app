import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  loadStreakLeaderboard,
  loadStreakLeaderboardInExecutor,
  type StreakLeaderboard,
  type StreakLeaderboardParticipantRow,
  type StreakLeaderboardRankingRow,
  type StreakLeaderboardRow,
} from "./streakLeaderboard";

type QueryResultRow = pg.QueryResultRow;

type SnapshotHeaderRow = Readonly<{
  snapshot_id: string;
  generated_at: Date;
  as_of_utc_date: string;
}>;

type SnapshotEntryRow = Readonly<{
  public_profile_id: string;
  streak_days: number;
  base_sort_position: number;
}>;

type FriendshipFixture = Readonly<{
  friendPublicProfileId: string;
  friendDisplayName: string;
  leaderboardParticipationEnabled: boolean;
}>;

type ViewerProfileFixture = Readonly<{
  publicProfileId: string;
  leaderboardParticipationEnabled: boolean;
}>;

type StreakLeaderboardExecutorFixture = Readonly<{
  viewerUserId: string;
  viewerProfile: ViewerProfileFixture;
  friendships: ReadonlyArray<FriendshipFixture>;
  header: SnapshotHeaderRow | null;
  entries: ReadonlyArray<SnapshotEntryRow>;
}>;

type RecordedQuery = Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>;

type RankingSummary = Readonly<{
  kind: StreakLeaderboardRankingRow["kind"];
  publicProfileId: string;
  streakDays: number;
  rank: number;
}>;

const VIEWER_USER_ID = "user-viewer";
const VIEWER_PROFILE_ID = "00000000-0000-4000-8000-0000000000a1";
const FRIEND_PROFILE_ID = "00000000-0000-4000-8000-000000000fa1";
const SNAPSHOT_ID = "3e6c0b88-5f5a-4db3-8c8c-9d6a3840a1e4";
const SNAPSHOT_GENERATED_AT = new Date("2026-06-10T12:00:05.000Z");
const EXPECTED_GENERATED_AT_ISO = "2026-06-10T12:00:05.000Z";
const EXPECTED_AS_OF_DATE = "2026-06-10";
const EXPECTED_NEXT_REFRESH_ISO = "2026-06-11T12:00:00.000Z";

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createReadyHeader(): SnapshotHeaderRow {
  return {
    snapshot_id: SNAPSHOT_ID,
    generated_at: SNAPSHOT_GENERATED_AT,
    as_of_utc_date: EXPECTED_AS_OF_DATE,
  };
}

function includesQuery(recordedQueries: ReadonlyArray<RecordedQuery>, substring: string): boolean {
  return recordedQueries.some((query) => query.text.includes(substring));
}

function participantRows(
  rows: ReadonlyArray<StreakLeaderboardRow>,
): ReadonlyArray<StreakLeaderboardParticipantRow> {
  return rows.filter((row): row is StreakLeaderboardParticipantRow => row.kind !== "gap");
}

function summarizeRankingRows(rows: ReadonlyArray<StreakLeaderboardRankingRow>): ReadonlyArray<RankingSummary> {
  return rows.map((row) => ({
    kind: row.kind,
    publicProfileId: row.publicProfileId,
    streakDays: row.streakDays,
    rank: row.rank,
  }));
}

function assertReadyLeaderboard(leaderboard: StreakLeaderboard): asserts leaderboard is Extract<StreakLeaderboard, { status: "ready" }> {
  assert.equal(leaderboard.status, "ready");
}

function assertNoFriendDisplayName(
  row: StreakLeaderboardParticipantRow | StreakLeaderboardRankingRow,
): void {
  assert.equal("friendDisplayName" in row, false);
}

function createStreakLeaderboardExecutor(
  fixture: StreakLeaderboardExecutorFixture,
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

      if (text.includes("FROM community.read_current_user_leaderboard_friend_labels() AS friend_labels")) {
        if (scopedUserId !== fixture.viewerUserId) {
          throw new Error("friendship read requires the viewer user scope");
        }
        if (params.length !== 0) {
          throw new Error("friendship read helper does not accept request parameters");
        }
        if (text.includes("friend_user_id")) {
          throw new Error("streak leaderboard friend label read must not select internal friend user ids");
        }

        return createQueryResult(
          fixture.friendships
            .filter((friendship) => friendship.leaderboardParticipationEnabled)
            .map((friendship) => ({
              friend_public_profile_id: friendship.friendPublicProfileId,
              friend_display_name: friendship.friendDisplayName,
            })),
        ) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("FROM community.streak_leaderboard_snapshots")) {
        assert.equal(params[0], "streak_days_v1");
        assert.equal(text.includes("user_id"), false);
        assert.equal(text.includes("email"), false);
        return createQueryResult(fixture.header === null ? [] : [fixture.header]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("FROM community.streak_leaderboard_snapshot_entries")) {
        assert.equal(params[0], fixture.header?.snapshot_id);
        for (const internalField of ["user_id", "email", "base_sort_position AS base_sort_position"]) {
          assert.equal(text.includes(internalField), internalField === "base_sort_position AS base_sort_position");
        }

        return createQueryResult(
          fixture.entries.map((entry) => ({
            public_profile_id: entry.public_profile_id,
            streak_days: entry.streak_days,
            base_sort_position: entry.base_sort_position,
          })),
        ) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected streak leaderboard read query: ${text}`);
    },
  };

  return { executor, recordedQueries };
}

test("guest viewers receive linked_account_required with localized metric copy and no database access", async () => {
  const leaderboard = await loadStreakLeaderboard({
    userId: VIEWER_USER_ID,
    transport: "guest",
    localeHint: "ru",
  });

  assert.equal(leaderboard.status, "linked_account_required");
  assert.equal(leaderboard.metric.metricVersion, "streak_days_v1");
  assert.notEqual(leaderboard.metric.title, "Current streak days");
  assert.equal("rows" in leaderboard, false);
});

test("opted-out viewers receive participation_disabled without reading snapshot data", async () => {
  const { executor, recordedQueries } = createStreakLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: false },
    friendships: [],
    header: createReadyHeader(),
    entries: [],
  });

  const leaderboard = await loadStreakLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
  );

  assert.equal(leaderboard.status, "participation_disabled");
  assert.equal("rows" in leaderboard, false);
  assert.equal(includesQuery(recordedQueries, "community.streak_leaderboard_snapshots"), false);
  assert.equal(includesQuery(recordedQueries, "community.streak_leaderboard_snapshot_entries"), false);
});

test("missing snapshots yield snapshot_unavailable without reading entries or friends", async () => {
  const { executor, recordedQueries } = createStreakLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    friendships: [],
    header: null,
    entries: [],
  });

  const leaderboard = await loadStreakLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "bearer", localeHint: "en" },
  );

  assert.equal(leaderboard.status, "snapshot_unavailable");
  assert.equal("rows" in leaderboard, false);
  assert.equal(includesQuery(recordedQueries, "community.read_current_user_leaderboard_friend_labels"), false);
  assert.equal(includesQuery(recordedQueries, "community.streak_leaderboard_snapshot_entries"), false);
});

test("equal streaks rank the viewer above non-viewers with the same value", async () => {
  const { executor } = createStreakLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    friendships: [],
    header: createReadyHeader(),
    entries: [
      { public_profile_id: "00000000-0000-4000-8000-0000000000c1", streak_days: 8, base_sort_position: 1 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000c2", streak_days: 5, base_sort_position: 2 },
      { public_profile_id: VIEWER_PROFILE_ID, streak_days: 5, base_sort_position: 3 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000c4", streak_days: 5, base_sort_position: 4 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000c5", streak_days: 2, base_sort_position: 5 },
    ],
  });

  const leaderboard = await loadStreakLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
  );

  assertReadyLeaderboard(leaderboard);
  assert.equal(leaderboard.viewer.rank, 2);
  assert.equal(leaderboard.viewer.streakDays, 5);
  assert.deepEqual(summarizeRankingRows(leaderboard.rankingRows), [
    {
      kind: "participant",
      publicProfileId: "00000000-0000-4000-8000-0000000000c1",
      streakDays: 8,
      rank: 1,
    },
    {
      kind: "viewer",
      publicProfileId: VIEWER_PROFILE_ID,
      streakDays: 5,
      rank: 2,
    },
    {
      kind: "participant",
      publicProfileId: "00000000-0000-4000-8000-0000000000c2",
      streakDays: 5,
      rank: 3,
    },
    {
      kind: "participant",
      publicProfileId: "00000000-0000-4000-8000-0000000000c4",
      streakDays: 5,
      rank: 4,
    },
    {
      kind: "participant",
      publicProfileId: "00000000-0000-4000-8000-0000000000c5",
      streakDays: 2,
      rank: 5,
    },
  ]);
});

test("ready response includes compact friend rows and excludes internal identifiers", async () => {
  const { executor } = createStreakLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    friendships: [
      {
        friendPublicProfileId: FRIEND_PROFILE_ID,
        friendDisplayName: "Mina",
        leaderboardParticipationEnabled: true,
      },
    ],
    header: createReadyHeader(),
    entries: [
      { public_profile_id: "00000000-0000-4000-8000-000000000101", streak_days: 30, base_sort_position: 1 },
      { public_profile_id: "00000000-0000-4000-8000-000000000102", streak_days: 25, base_sort_position: 2 },
      { public_profile_id: "00000000-0000-4000-8000-000000000103", streak_days: 20, base_sort_position: 3 },
      { public_profile_id: "00000000-0000-4000-8000-000000000104", streak_days: 18, base_sort_position: 4 },
      { public_profile_id: FRIEND_PROFILE_ID, streak_days: 16, base_sort_position: 5 },
      { public_profile_id: "00000000-0000-4000-8000-000000000106", streak_days: 14, base_sort_position: 6 },
      { public_profile_id: VIEWER_PROFILE_ID, streak_days: 12, base_sort_position: 7 },
      { public_profile_id: "00000000-0000-4000-8000-000000000108", streak_days: 8, base_sort_position: 8 },
      { public_profile_id: "00000000-0000-4000-8000-000000000109", streak_days: 4, base_sort_position: 9 },
      { public_profile_id: "00000000-0000-4000-8000-000000000110", streak_days: 0, base_sort_position: 10 },
    ],
  });

  const leaderboard = await loadStreakLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
  );

  assertReadyLeaderboard(leaderboard);
  assert.equal(leaderboard.snapshotId, SNAPSHOT_ID);
  assert.equal(leaderboard.snapshotGeneratedAt, EXPECTED_GENERATED_AT_ISO);
  assert.equal(leaderboard.asOfUtcDate, EXPECTED_AS_OF_DATE);
  assert.equal(leaderboard.nextRefreshAfter, EXPECTED_NEXT_REFRESH_ISO);
  assert.equal(leaderboard.participantCount, 10);
  assert.equal(leaderboard.rankingRows.length, leaderboard.participantCount);
  assert.deepEqual(
    leaderboard.rows.map((row) => (row.kind === "gap" ? "gap" : `${row.kind}:${row.rank}`)),
    [
      "top:1",
      "top:2",
      "top:3",
      "gap",
      "neighbor:5",
      "neighbor:6",
      "viewer:7",
      "neighbor:8",
      "gap",
      "neighbor:10",
    ],
  );

  const friendCompactRow = participantRows(leaderboard.rows)
    .find((row) => row.publicProfileId === FRIEND_PROFILE_ID);
  const friendRankingRow = leaderboard.rankingRows
    .find((row) => row.publicProfileId === FRIEND_PROFILE_ID);
  const nonFriendRankingRow = leaderboard.rankingRows
    .find((row) => row.publicProfileId === "00000000-0000-4000-8000-000000000104");

  assert.equal(friendCompactRow?.friendDisplayName, "Mina");
  assert.equal(friendRankingRow?.friendDisplayName, "Mina");
  if (nonFriendRankingRow === undefined) {
    throw new Error("Expected a non-friend ranking row.");
  }
  assertNoFriendDisplayName(nonFriendRankingRow);

  const serialized = JSON.stringify(leaderboard);
  assert.equal(serialized.includes("publicProfileId"), true);
  assert.equal(serialized.includes("anonymousDisplayName"), true);
  assert.equal(serialized.includes("friendDisplayName"), true);
  assert.equal(serialized.includes("streakDays"), true);
  assert.equal(serialized.includes("qualifiedReviewCount"), false);
  for (const internalField of [
    VIEWER_USER_ID,
    "user_id",
    "userId",
    "friend_user_id",
    "friendUserId",
    "friend_public_profile_id",
    "friendPublicProfileId",
    "base_sort",
    "baseSort",
    "email",
  ]) {
    assert.equal(serialized.includes(internalField), false, `serialized payload must not include ${internalField}`);
  }
});
