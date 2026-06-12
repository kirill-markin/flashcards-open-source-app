import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  LEADERBOARD_WINDOW_KEYS,
  resolveDefaultLeaderboardWindowKey,
} from "./leaderboardWindows";
import {
  loadProgressLeaderboard,
  loadProgressLeaderboardInExecutor,
  type ProgressLeaderboard,
  type ProgressLeaderboardParticipantRow,
  type ProgressLeaderboardRow,
} from "./progressLeaderboard";

type QueryResultRow = pg.QueryResultRow;

type SnapshotHeaderRow = Readonly<{
  window_key: string;
  snapshot_id: string;
  generated_at: Date;
  as_of_server_hour: Date;
}>;

type SnapshotEntryRow = Readonly<{
  public_profile_id: string;
  qualified_review_count: number;
  base_sort_position: number;
}>;

type ViewerProfileFixture = Readonly<{
  publicProfileId: string;
  leaderboardParticipationEnabled: boolean;
}>;

type LeaderboardExecutorFixture = Readonly<{
  viewerUserId: string;
  viewerProfile: ViewerProfileFixture;
  latestReviewedAtClient: Date | null;
  headers: ReadonlyArray<SnapshotHeaderRow>;
  entriesBySnapshotId: Readonly<Record<string, ReadonlyArray<SnapshotEntryRow>>>;
}>;

type RecordedQuery = Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>;

const VIEWER_USER_ID = "user-viewer";
const VIEWER_PROFILE_ID = "00000000-0000-4000-8000-0000000000a1";
const AS_OF_SERVER_HOUR = new Date("2026-06-10T14:00:00.000Z");
const SNAPSHOT_GENERATED_AT = new Date("2026-06-10T14:00:05.000Z");
const EXPECTED_AS_OF_ISO = "2026-06-10T14:00:00.000Z";
const EXPECTED_GENERATED_AT_ISO = "2026-06-10T14:00:05.000Z";
const EXPECTED_NEXT_REFRESH_ISO = "2026-06-10T15:00:00.000Z";
const NOW = new Date("2026-06-10T14:30:00.000Z");
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function snapshotIdForWindow(windowKey: string): string {
  return `snapshot-${windowKey}`;
}

function createReadyHeaders(): ReadonlyArray<SnapshotHeaderRow> {
  return LEADERBOARD_WINDOW_KEYS.map((windowKey) => ({
    window_key: windowKey,
    snapshot_id: snapshotIdForWindow(windowKey),
    generated_at: SNAPSHOT_GENERATED_AT,
    as_of_server_hour: AS_OF_SERVER_HOUR,
  }));
}

function createEntriesForWindow(
  windowKey: string,
  entries: ReadonlyArray<SnapshotEntryRow>,
): Readonly<Record<string, ReadonlyArray<SnapshotEntryRow>>> {
  return { [snapshotIdForWindow(windowKey)]: entries };
}

function isStringArray(value: SqlValue | undefined): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * In-memory fake of the request-scoped executor exercised by the leaderboard read.
 * It reproduces the scope handshake, the viewer profile read, the viewer's latest
 * countable review, the latest-snapshot-per-window header read, and the entry read,
 * and throws on any query the loader is not expected to issue so privacy
 * short-circuits (guest, opt-out, missing snapshots) are observable.
 */
function createLeaderboardExecutor(
  fixture: LeaderboardExecutorFixture,
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

      if (text.includes("MAX(facts.reviewed_at_client)")) {
        return createQueryResult([
          { latest_reviewed_at_client: fixture.latestReviewedAtClient },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.includes("FROM community.leaderboard_snapshots")
        && text.includes("DISTINCT ON (snapshots.window_key)")
      ) {
        return createQueryResult(fixture.headers) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("FROM community.leaderboard_snapshot_entries")) {
        const snapshotIds = params[0];
        if (!isStringArray(snapshotIds)) {
          throw new Error("entry read requires a snapshot id array parameter");
        }

        const rows = snapshotIds.flatMap((snapshotId) =>
          (fixture.entriesBySnapshotId[snapshotId] ?? []).map((entry) => ({
            snapshot_id: snapshotId,
            public_profile_id: entry.public_profile_id,
            qualified_review_count: entry.qualified_review_count,
            base_sort_position: entry.base_sort_position,
          })),
        );

        return createQueryResult(rows) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected leaderboard read query: ${text}`);
    },
  };

  return { executor, recordedQueries };
}

function findWindow(leaderboard: ProgressLeaderboard, windowKey: string) {
  const window = leaderboard.windows.find((candidate) => candidate.windowKey === windowKey);
  if (window === undefined) {
    throw new Error(`Missing window ${windowKey} in leaderboard response`);
  }

  return window;
}

function participantRows(
  rows: ReadonlyArray<ProgressLeaderboardRow>,
): ReadonlyArray<ProgressLeaderboardParticipantRow> {
  return rows.filter((row): row is ProgressLeaderboardParticipantRow => row.kind !== "gap");
}

function includesQuery(recordedQueries: ReadonlyArray<RecordedQuery>, substring: string): boolean {
  return recordedQueries.some((query) => query.text.includes(substring));
}

test("resolveDefaultLeaderboardWindowKey maps elapsed hours to a bounded window and never all_time", () => {
  assert.equal(resolveDefaultLeaderboardWindowKey(null), "last_24_hours");
  assert.equal(resolveDefaultLeaderboardWindowKey(0), "last_24_hours");
  assert.equal(resolveDefaultLeaderboardWindowKey(24), "last_24_hours");
  assert.equal(resolveDefaultLeaderboardWindowKey(24.5), "last_3_days");
  assert.equal(resolveDefaultLeaderboardWindowKey(72), "last_3_days");
  assert.equal(resolveDefaultLeaderboardWindowKey(100), "last_7_days");
  assert.equal(resolveDefaultLeaderboardWindowKey(168), "last_7_days");
  assert.equal(resolveDefaultLeaderboardWindowKey(200), "last_30_days");
  assert.equal(resolveDefaultLeaderboardWindowKey(720), "last_30_days");
  // Older than 30 days clamps to last_30_days, never all_time.
  assert.equal(resolveDefaultLeaderboardWindowKey(5000), "last_30_days");
});

test("guest viewers receive linked_account_required with no rows and no database access", async () => {
  const leaderboard = await loadProgressLeaderboard({
    userId: VIEWER_USER_ID,
    transport: "guest",
    localeHint: "en",
  });

  assert.equal(leaderboard.status, "linked_account_required");
  assert.deepEqual(leaderboard.windows, []);
  assert.equal(leaderboard.defaultWindowKey, "last_24_hours");
  assert.equal(leaderboard.metric.metricVersion, "qualified_reviews_v1");
});

test("opted-out viewers receive participation_disabled without reading any other user rows", async () => {
  const { executor, recordedQueries } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: false },
    latestReviewedAtClient: null,
    headers: createReadyHeaders(),
    entriesBySnapshotId: {},
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );

  assert.equal(leaderboard.status, "participation_disabled");
  assert.deepEqual(leaderboard.windows, []);
  assert.equal(includesQuery(recordedQueries, "community.leaderboard_snapshots"), false);
  assert.equal(includesQuery(recordedQueries, "community.leaderboard_snapshot_entries"), false);
});

test("missing snapshots yield snapshot_unavailable without reading entries", async () => {
  const { executor, recordedQueries } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: null,
    headers: [],
    entriesBySnapshotId: {},
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "bearer", localeHint: "en" },
    NOW,
  );

  assert.equal(leaderboard.status, "snapshot_unavailable");
  assert.deepEqual(leaderboard.windows, []);
  assert.equal(includesQuery(recordedQueries, "community.leaderboard_snapshot_entries"), false);
});

test("ready response defaults to the window of the viewer's latest countable review", async () => {
  // 100 hours before NOW falls inside the 7-day window but outside the 3-day window.
  const latestReviewedAtClient = new Date(NOW.getTime() - 100 * MILLISECONDS_PER_HOUR);
  const { executor } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient,
    headers: createReadyHeaders(),
    entriesBySnapshotId: createEntriesForWindow("last_7_days", [
      { public_profile_id: VIEWER_PROFILE_ID, qualified_review_count: 9, base_sort_position: 1 },
    ]),
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );

  assert.equal(leaderboard.status, "ready");
  assert.equal(leaderboard.defaultWindowKey, "last_7_days");
  assert.equal(leaderboard.windows.length, LEADERBOARD_WINDOW_KEYS.length);
  const window = findWindow(leaderboard, "last_7_days");
  assert.equal(window.snapshotGeneratedAt, EXPECTED_GENERATED_AT_ISO);
  assert.equal(window.asOfServerHour, EXPECTED_AS_OF_ISO);
  assert.equal(window.nextRefreshAfter, EXPECTED_NEXT_REFRESH_ISO);
  assert.equal(window.viewer.qualifiedReviewCount, 9);
  assert.equal(window.viewer.rank, 1);
});

test("a zero-count viewer defaults to last_24_hours and still appears ranked last with zero", async () => {
  const { executor } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: null,
    headers: createReadyHeaders(),
    entriesBySnapshotId: createEntriesForWindow("last_24_hours", [
      { public_profile_id: "00000000-0000-4000-8000-0000000000b1", qualified_review_count: 5, base_sort_position: 1 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000b2", qualified_review_count: 3, base_sort_position: 2 },
    ]),
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );

  assert.equal(leaderboard.status, "ready");
  assert.equal(leaderboard.defaultWindowKey, "last_24_hours");
  const window = findWindow(leaderboard, "last_24_hours");
  assert.equal(window.participantCount, 3);
  assert.equal(window.viewer.qualifiedReviewCount, 0);
  assert.equal(window.viewer.rank, 3);
  const viewerRow = participantRows(window.rows).find((row) => row.kind === "viewer");
  assert.notEqual(viewerRow, undefined);
  assert.equal(viewerRow?.qualifiedReviewCount, 0);
  assert.equal(viewerRow?.rank, 3);
  assert.equal(viewerRow?.publicProfileId, VIEWER_PROFILE_ID);
});

test("equal counts rank the viewer below other users with the same count", async () => {
  const { executor } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: null,
    headers: createReadyHeaders(),
    entriesBySnapshotId: createEntriesForWindow("last_24_hours", [
      { public_profile_id: "00000000-0000-4000-8000-0000000000c1", qualified_review_count: 5, base_sort_position: 1 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000c2", qualified_review_count: 5, base_sort_position: 2 },
      { public_profile_id: VIEWER_PROFILE_ID, qualified_review_count: 5, base_sort_position: 3 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000c4", qualified_review_count: 3, base_sort_position: 4 },
    ]),
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );

  const window = findWindow(leaderboard, "last_24_hours");
  // Viewer ties three users at count 5 but is placed below the two other equal-count users.
  assert.equal(window.viewer.rank, 3);
  assert.equal(window.viewer.qualifiedReviewCount, 5);
  const rows = participantRows(window.rows);
  assert.deepEqual(
    rows.map((row) => ({ kind: row.kind, rank: row.rank, count: row.qualifiedReviewCount })),
    [
      { kind: "top", rank: 1, count: 5 },
      { kind: "top", rank: 2, count: 5 },
      { kind: "viewer", rank: 3, count: 5 },
      { kind: "neighbor", rank: 4, count: 3 },
    ],
  );
});

test("compact rows show the top three, gaps, and the viewer with its neighbors", async () => {
  const otherEntries: ReadonlyArray<SnapshotEntryRow> = [
    { public_profile_id: "00000000-0000-4000-8000-0000000000d1", qualified_review_count: 100, base_sort_position: 1 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d2", qualified_review_count: 90, base_sort_position: 2 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d3", qualified_review_count: 80, base_sort_position: 3 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d4", qualified_review_count: 70, base_sort_position: 4 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d5", qualified_review_count: 60, base_sort_position: 5 },
    { public_profile_id: VIEWER_PROFILE_ID, qualified_review_count: 55, base_sort_position: 6 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d7", qualified_review_count: 50, base_sort_position: 7 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d8", qualified_review_count: 40, base_sort_position: 8 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000d9", qualified_review_count: 30, base_sort_position: 9 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000da", qualified_review_count: 20, base_sort_position: 10 },
  ];
  const { executor } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: null,
    headers: createReadyHeaders(),
    entriesBySnapshotId: createEntriesForWindow("last_24_hours", otherEntries),
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );

  const window = findWindow(leaderboard, "last_24_hours");
  assert.equal(window.participantCount, 10);
  assert.equal(window.viewer.rank, 6);

  const kindsAndRanks = window.rows.map((row) => (row.kind === "gap" ? "gap" : `${row.kind}:${row.rank}`));
  assert.deepEqual(kindsAndRanks, [
    "top:1",
    "top:2",
    "top:3",
    "gap",
    "neighbor:5",
    "viewer:6",
    "neighbor:7",
    "gap",
  ]);

  // The top three rows always precede the first hidden-rank gap row.
  assert.equal(window.rows[0]?.kind, "top");
  assert.equal(window.rows[3]?.kind, "gap");
  assert.equal(window.rows[7]?.kind, "gap");
  assert.equal(window.rows.filter((row) => row.kind === "gap").length, 2);
});

test("a viewer near the top produces contiguous rows with no gap", async () => {
  const { executor } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: null,
    headers: createReadyHeaders(),
    entriesBySnapshotId: createEntriesForWindow("last_24_hours", [
      { public_profile_id: "00000000-0000-4000-8000-0000000000e1", qualified_review_count: 30, base_sort_position: 1 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000e2", qualified_review_count: 20, base_sort_position: 2 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000e3", qualified_review_count: 15, base_sort_position: 3 },
      { public_profile_id: VIEWER_PROFILE_ID, qualified_review_count: 10, base_sort_position: 4 },
      { public_profile_id: "00000000-0000-4000-8000-0000000000e5", qualified_review_count: 5, base_sort_position: 5 },
    ]),
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );

  const window = findWindow(leaderboard, "last_24_hours");
  assert.equal(window.viewer.rank, 4);
  assert.equal(window.rows.some((row) => row.kind === "gap"), false);
  assert.deepEqual(
    window.rows.map((row) => (row.kind === "gap" ? "gap" : `${row.kind}:${row.rank}`)),
    ["top:1", "top:2", "top:3", "viewer:4", "neighbor:5"],
  );
});

test("anonymous names change with locale while ids, counts, and ranks stay stable", async () => {
  const entries = createEntriesForWindow("last_24_hours", [
    { public_profile_id: "00000000-0000-4000-8000-0000000000f1", qualified_review_count: 9, base_sort_position: 1 },
    { public_profile_id: "00000000-0000-4000-8000-0000000000f2", qualified_review_count: 4, base_sort_position: 2 },
    { public_profile_id: VIEWER_PROFILE_ID, qualified_review_count: 1, base_sort_position: 3 },
  ]);
  const buildFixture = (): LeaderboardExecutorFixture => ({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: null,
    headers: createReadyHeaders(),
    entriesBySnapshotId: entries,
  });

  const englishLeaderboard = await loadProgressLeaderboardInExecutor(
    createLeaderboardExecutor(buildFixture()).executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );
  const russianLeaderboard = await loadProgressLeaderboardInExecutor(
    createLeaderboardExecutor(buildFixture()).executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "ru" },
    NOW,
  );

  const englishWindow = findWindow(englishLeaderboard, "last_24_hours");
  const russianWindow = findWindow(russianLeaderboard, "last_24_hours");
  const englishRows = participantRows(englishWindow.rows);
  const russianRows = participantRows(russianWindow.rows);

  assert.deepEqual(
    englishRows.map((row) => ({ id: row.publicProfileId, count: row.qualifiedReviewCount, rank: row.rank })),
    russianRows.map((row) => ({ id: row.publicProfileId, count: row.qualifiedReviewCount, rank: row.rank })),
  );
  const englishTopName = englishRows[0]?.anonymousDisplayName ?? "";
  const russianTopName = russianRows[0]?.anonymousDisplayName ?? "";
  assert.notEqual(englishTopName, "");
  assert.notEqual(russianTopName, "");
  assert.notEqual(englishTopName, russianTopName);
  // Metric copy is localized too, but the metric version key stays stable.
  assert.equal(englishLeaderboard.metric.metricVersion, russianLeaderboard.metric.metricVersion);
  assert.notEqual(englishLeaderboard.metric.title, russianLeaderboard.metric.title);
});

test("ready response serializes only public fields, never internal identifiers", async () => {
  const { executor } = createLeaderboardExecutor({
    viewerUserId: VIEWER_USER_ID,
    viewerProfile: { publicProfileId: VIEWER_PROFILE_ID, leaderboardParticipationEnabled: true },
    latestReviewedAtClient: new Date(NOW.getTime() - 2 * MILLISECONDS_PER_HOUR),
    headers: createReadyHeaders(),
    entriesBySnapshotId: createEntriesForWindow("last_24_hours", [
      { public_profile_id: "00000000-0000-4000-8000-000000000aa1", qualified_review_count: 7, base_sort_position: 1 },
      { public_profile_id: VIEWER_PROFILE_ID, qualified_review_count: 2, base_sort_position: 2 },
    ]),
  });

  const leaderboard = await loadProgressLeaderboardInExecutor(
    executor,
    { userId: VIEWER_USER_ID, transport: "session", localeHint: "en" },
    NOW,
  );
  const serialized = JSON.stringify(leaderboard);

  assert.equal(serialized.includes("publicProfileId"), true);
  assert.equal(serialized.includes("anonymousDisplayName"), true);
  assert.equal(serialized.includes("qualifiedReviewCount"), true);
  for (const internalField of [
    VIEWER_USER_ID,
    "user_id",
    "userId",
    "reviewed_by",
    "reviewedBy",
    "base_sort",
    "baseSort",
    "reviewed_at",
    "reviewedAt",
    "email",
  ]) {
    assert.equal(serialized.includes(internalField), false, `serialized payload must not include ${internalField}`);
  }
});
