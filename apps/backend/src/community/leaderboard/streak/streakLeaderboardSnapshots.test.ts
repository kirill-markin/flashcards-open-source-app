import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import {
  STREAK_LEADERBOARD_SNAPSHOT_BATCH_SIZE,
  STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
  generateStreakLeaderboardSnapshotsWithDependencies,
  listStreakLeaderboardActiveReviewLocalDatesInExecutor,
  listStreakLeaderboardParticipantsInExecutor,
  replaceStreakLeaderboardSnapshotEntriesInExecutor,
  upsertStreakLeaderboardSnapshotInExecutor,
  type StreakLeaderboardActiveReviewLocalDate,
  type StreakLeaderboardParticipant,
  type StreakLeaderboardSnapshotEntry,
} from "./streakLeaderboardSnapshots";

type QueryResultRow = pg.QueryResultRow;

type QueryCall = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type ParticipantPageCall = Readonly<{
  afterPublicProfileId: string | null;
  limit: number;
}>;

type UpsertCall = Readonly<{
  metricVersion: string;
  asOfUtcDate: string;
  generatedAt: string;
}>;

const PROFILE_A = "00000000-0000-4000-8000-00000000000a";
const PROFILE_B = "00000000-0000-4000-8000-00000000000b";
const PROFILE_C = "00000000-0000-4000-8000-00000000000c";
const PROFILE_D = "00000000-0000-4000-8000-00000000000d";
const PROFILE_E = "00000000-0000-4000-8000-00000000000e";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000099";
const NOW = new Date("2026-06-20T00:30:00.000Z");

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createNoopExecutor(): DatabaseExecutor {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      _params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      throw new Error(`Unexpected streak leaderboard snapshot query: ${text}`);
    },
  };
}

function createTransactionRunner(executor: DatabaseExecutor) {
  return async <Result>(callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>): Promise<Result> => (
    callback(executor)
  );
}

function sliceParticipantsAfter(
  participants: ReadonlyArray<StreakLeaderboardParticipant>,
  afterPublicProfileId: string | null,
  limit: number,
): ReadonlyArray<StreakLeaderboardParticipant> {
  const afterIndex = afterPublicProfileId === null
    ? -1
    : participants.findIndex((participant) => participant.publicProfileId === afterPublicProfileId);
  if (afterPublicProfileId !== null && afterIndex === -1) {
    throw new Error(`Unknown afterPublicProfileId=${String(afterPublicProfileId)}`);
  }

  const startIndex = afterIndex + 1;
  return participants.slice(startIndex, startIndex + limit);
}

test("generateStreakLeaderboardSnapshots batches participants and stores timezone-aware freeze streaks", async () => {
  const participants: ReadonlyArray<StreakLeaderboardParticipant> = [
    { publicProfileId: PROFILE_A, userId: "user-a", progressTimeZone: "America/Los_Angeles" },
    { publicProfileId: PROFILE_B, userId: "user-b", progressTimeZone: "UTC" },
    { publicProfileId: PROFILE_C, userId: "user-c", progressTimeZone: "Pacific/Kiritimati" },
    { publicProfileId: PROFILE_D, userId: "user-d", progressTimeZone: "UTC" },
    { publicProfileId: PROFILE_E, userId: "user-e", progressTimeZone: "UTC" },
  ];
  const activeDatesByUser = new Map<string, ReadonlyArray<string>>([
    ["user-a", ["2026-06-18"]],
    ["user-c", ["2026-06-19", "2026-06-17"]],
    ["user-d", ["2026-06-20"]],
  ]);
  const participantPageCalls: Array<ParticipantPageCall> = [];
  const activeDayCalls: Array<ReadonlyArray<string>> = [];
  const upsertCalls: Array<UpsertCall> = [];
  let storedEntries: ReadonlyArray<StreakLeaderboardSnapshotEntry> = [];

  const result = await generateStreakLeaderboardSnapshotsWithDependencies({
    metricVersion: STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    batchSize: 2,
    now: () => NOW,
    withTransactionFn: createTransactionRunner(createNoopExecutor()),
    listParticipantsFn: async (_executor, params) => {
      participantPageCalls.push(params);
      return sliceParticipantsAfter(participants, params.afterPublicProfileId, params.limit);
    },
    listActiveReviewLocalDatesFn: async (_executor, userIds) => {
      activeDayCalls.push([...userIds]);
      return userIds.flatMap((userId) => (
        activeDatesByUser.get(userId) ?? []
      ).map((localDate) => ({
        reviewedByUserId: userId,
        localDate,
      })));
    },
    upsertSnapshotFn: async (_executor, metricVersion, asOfUtcDate, generatedAt) => {
      upsertCalls.push({ metricVersion, asOfUtcDate, generatedAt });
      return SNAPSHOT_ID;
    },
    replaceSnapshotEntriesFn: async (_executor, snapshotId, entries) => {
      assert.equal(snapshotId, SNAPSHOT_ID);
      storedEntries = entries;
      return entries.length;
    },
  });

  assert.deepEqual(participantPageCalls, [
    { afterPublicProfileId: null, limit: 2 },
    { afterPublicProfileId: PROFILE_B, limit: 2 },
    { afterPublicProfileId: PROFILE_D, limit: 2 },
  ]);
  assert.deepEqual(activeDayCalls, [
    ["user-a", "user-b"],
    ["user-c", "user-d"],
    ["user-e"],
  ]);
  assert.deepEqual(upsertCalls, [{
    metricVersion: STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    asOfUtcDate: "2026-06-20",
    generatedAt: NOW.toISOString(),
  }]);
  assert.deepEqual(storedEntries, [
    { publicProfileId: PROFILE_C, streakDays: 3, baseSortPosition: 1 },
    { publicProfileId: PROFILE_A, streakDays: 1, baseSortPosition: 2 },
    { publicProfileId: PROFILE_D, streakDays: 1, baseSortPosition: 3 },
    { publicProfileId: PROFILE_B, streakDays: 0, baseSortPosition: 4 },
    { publicProfileId: PROFILE_E, streakDays: 0, baseSortPosition: 5 },
  ]);
  assert.deepEqual(result, {
    metricVersion: STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    generatedAt: NOW.toISOString(),
    asOfUtcDate: "2026-06-20",
    snapshotId: SNAPSHOT_ID,
    pagesScanned: 3,
    participantsScanned: 5,
    entryCount: 5,
  });
});

test("streak leaderboard executor helpers use the dedicated snapshot database functions", async () => {
  const calls: Array<QueryCall> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      calls.push({ text, params });
      if (text.includes("list_streak_leaderboard_snapshot_participants")) {
        return createQueryResult([{
          public_profile_id: PROFILE_A,
          user_id: "user-a",
          progress_time_zone: "Europe/Madrid",
        }]) as unknown as pg.QueryResult<Row>;
      }
      if (text.includes("list_streak_leaderboard_snapshot_active_days")) {
        return createQueryResult([{
          reviewed_by_user_id: "user-a",
          local_date: "2026-06-20",
        }]) as unknown as pg.QueryResult<Row>;
      }
      if (text.includes("upsert_streak_leaderboard_snapshot")) {
        return createQueryResult([{ snapshot_id: SNAPSHOT_ID }]) as unknown as pg.QueryResult<Row>;
      }
      if (text.includes("replace_streak_leaderboard_snapshot_entries")) {
        return createQueryResult([{ inserted_entries: 1 }]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const participants = await listStreakLeaderboardParticipantsInExecutor(executor, {
    afterPublicProfileId: PROFILE_A,
    limit: 50,
  });
  const activeDates = await listStreakLeaderboardActiveReviewLocalDatesInExecutor(executor, ["user-a"]);
  const snapshotId = await upsertStreakLeaderboardSnapshotInExecutor(
    executor,
    STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    "2026-06-20",
    NOW.toISOString(),
  );
  const insertedEntries = await replaceStreakLeaderboardSnapshotEntriesInExecutor(executor, SNAPSHOT_ID, [{
    publicProfileId: PROFILE_A,
    streakDays: 1,
    baseSortPosition: 1,
  }]);

  assert.deepEqual(participants, [{
    publicProfileId: PROFILE_A,
    userId: "user-a",
    progressTimeZone: "Europe/Madrid",
  }]);
  assert.deepEqual(activeDates, [{
    reviewedByUserId: "user-a",
    localDate: "2026-06-20",
  } satisfies StreakLeaderboardActiveReviewLocalDate]);
  assert.equal(snapshotId, SNAPSHOT_ID);
  assert.equal(insertedEntries, 1);
  assert.match(calls[0]?.text ?? "", /community\.list_streak_leaderboard_snapshot_participants\(\$1::uuid, \$2::integer\)/);
  assert.deepEqual(calls[0]?.params, [PROFILE_A, 50]);
  assert.match(calls[1]?.text ?? "", /community\.list_streak_leaderboard_snapshot_active_days\(\$1::text\[\]\)/);
  assert.deepEqual(calls[1]?.params, [["user-a"]]);
  assert.match(calls[2]?.text ?? "", /community\.upsert_streak_leaderboard_snapshot\(\$1, \$2::date, \$3\)/);
  assert.deepEqual(calls[2]?.params, [
    STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    "2026-06-20",
    NOW.toISOString(),
  ]);
  assert.match(calls[3]?.text ?? "", /community\.replace_streak_leaderboard_snapshot_entries/);
  assert.deepEqual(calls[3]?.params, [
    SNAPSHOT_ID,
    [PROFILE_A],
    [1],
    [1],
  ]);
});

test("production streak leaderboard snapshot generation uses one repeatable-read transaction", () => {
  const sourcePath = resolve(
    process.cwd(),
    "src/community/leaderboard/streak/streakLeaderboardSnapshots.ts",
  );
  const source = readFileSync(sourcePath, "utf8").replace(/\s+/g, " ");

  assert.equal(STREAK_LEADERBOARD_SNAPSHOT_BATCH_SIZE, 500);
  assert.match(source, /import \{ unsafeRepeatableReadTransaction \} from "\.\.\/\.\.\/\.\.\/database\/unsafe"/);
  assert.match(source, /withTransactionFn: unsafeRepeatableReadTransaction/);
});

test("streak leaderboard snapshot Lambda retries transient database failures", () => {
  const sourcePath = resolve(
    process.cwd(),
    "src/entrypoints/lambda-streak-leaderboard-snapshot.ts",
  );
  const source = readFileSync(sourcePath, "utf8").replace(/\s+/g, " ");

  assert.match(source, /initializeBackendSentry\("streak-leaderboard-snapshot"\)/);
  assert.match(source, /import \{ withTransientDatabaseRetry \} from "\.\.\/database\/transient"/);
  assert.match(source, /const result = await withTransientDatabaseRetry\( \(\) => runtime\.generateStreakLeaderboardSnapshots\(\), \(\) => observationScope, \)/);
});

test("0069 migration creates streak leaderboard snapshot storage and privileged job helpers", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0069_streak_leaderboard_snapshots.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS community\.streak_leaderboard_snapshots/);
  assert.match(sql, /snapshot_id UUID PRIMARY KEY/);
  assert.match(sql, /metric_version TEXT NOT NULL/);
  assert.match(sql, /as_of_utc_date DATE NOT NULL/);
  assert.match(sql, /generated_at TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /UNIQUE \(metric_version, as_of_utc_date\)/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS community\.streak_leaderboard_snapshot_entries/);
  assert.match(sql, /snapshot_id UUID NOT NULL REFERENCES community\.streak_leaderboard_snapshots\(snapshot_id\) ON DELETE CASCADE/);
  assert.match(sql, /public_profile_id UUID NOT NULL REFERENCES community\.public_profiles\(public_profile_id\) ON DELETE CASCADE/);
  assert.match(sql, /streak_days INTEGER NOT NULL CHECK \(streak_days >= 0\)/);
  assert.match(sql, /base_sort_position INTEGER NOT NULL CHECK \(base_sort_position > 0\)/);
  assert.match(sql, /PRIMARY KEY \(snapshot_id, public_profile_id\)/);
  assert.match(sql, /idx_streak_leaderboard_snapshots_metric_as_of ON community\.streak_leaderboard_snapshots\(metric_version, as_of_utc_date DESC\)/);
  assert.match(sql, /idx_streak_leaderboard_snapshot_entries_snapshot_rank ON community\.streak_leaderboard_snapshot_entries\(snapshot_id, streak_days DESC, base_sort_position ASC\)/);

  assert.match(sql, /ALTER TABLE community\.streak_leaderboard_snapshots ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE community\.streak_leaderboard_snapshot_entries ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT ON TABLE community\.streak_leaderboard_snapshots TO backend_app/);
  assert.match(sql, /GRANT SELECT ON TABLE community\.streak_leaderboard_snapshot_entries TO backend_app/);
  assert.equal(/GRANT (INSERT|UPDATE|DELETE)[^;]*streak_leaderboard/.test(sql), false);

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.list_streak_leaderboard_snapshot_participants/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /FROM community\.public_profiles AS profiles INNER JOIN org\.user_settings AS user_settings/);
  assert.match(sql, /profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /user_settings\.progress_time_zone IS NOT NULL/);
  assert.match(sql, /user_settings\.email IS NULL OR LOWER\(btrim\(user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.match(sql, /ORDER BY profiles\.public_profile_id ASC LIMIT p_limit/);

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.list_streak_leaderboard_snapshot_active_days/);
  assert.match(sql, /FROM progress\.user_active_review_days AS active_days/);
  assert.match(sql, /WHERE active_days\.reviewed_by_user_id = ANY\(p_user_ids\)/);
  assert.match(sql, /ORDER BY active_days\.reviewed_by_user_id ASC, active_days\.local_date ASC/);

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.upsert_streak_leaderboard_snapshot/);
  assert.match(sql, /ON CONFLICT \(metric_version, as_of_utc_date\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.replace_streak_leaderboard_snapshot_entries/);
  assert.match(sql, /DELETE FROM community\.streak_leaderboard_snapshot_entries WHERE snapshot_id = p_snapshot_id/);
  assert.match(sql, /FROM unnest\( p_public_profile_ids, p_streak_days, p_base_sort_positions \)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.list_streak_leaderboard_snapshot_participants\(UUID, INTEGER\) TO backend_app/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.list_streak_leaderboard_snapshot_active_days\(TEXT\[\]\) TO backend_app/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.upsert_streak_leaderboard_snapshot\(TEXT, DATE, TIMESTAMPTZ\) TO backend_app/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.replace_streak_leaderboard_snapshot_entries\(UUID, UUID\[\], INTEGER\[\], INTEGER\[\]\) TO backend_app/);
});
