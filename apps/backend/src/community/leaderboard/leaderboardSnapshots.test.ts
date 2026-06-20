import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  generateLeaderboardSnapshotsWithDependencies,
  refreshLeaderboardSnapshotInExecutor,
} from "./leaderboardSnapshots";
import {
  InvalidLeaderboardWindowKeyError,
  LEADERBOARD_SNAPSHOT_METRIC_VERSION,
  LEADERBOARD_WINDOWS,
  UnsupportedLeaderboardMetricVersionError,
  assertLeaderboardWindowKey,
  truncateToServerHour,
} from "./leaderboardWindows";

type QueryResultRow = pg.QueryResultRow;

type StoredActivityActorKind =
  | "client_installation"
  | "workspace_seed"
  | "workspace_reset"
  | "agent_connection"
  | "ai_chat";

type StoredActivityPlatform = "web" | "android" | "ios" | "system";

type StoredFact = Readonly<{
  publicProfileId: string;
  metricVersion: string;
  isCountable: boolean;
  reviewedAtClient: string;
  actorKind: StoredActivityActorKind;
  platform: StoredActivityPlatform;
  reviewedByEmail: string | null;
}>;

type StoredProfile = Readonly<{
  publicProfileId: string;
  userId: string;
  participationEnabled: boolean;
}>;

type StoredUser = Readonly<{
  userId: string;
  email: string | null;
}>;

type RefreshCall = Readonly<{
  metricVersion: string;
  windowKey: string;
  lowerBoundHours: number | null;
  asOfServerHour: string;
  generatedAt: string;
}>;

type StoredSnapshot = {
  snapshotId: string;
  generatedAt: string;
};

type StoredEntry = Readonly<{
  publicProfileId: string;
  qualifiedReviewCount: number;
  baseSortPosition: number;
}>;

type MutableLeaderboardStoreState = {
  facts: Array<StoredFact>;
  profilesById: Map<string, StoredProfile>;
  usersById: Map<string, StoredUser>;
  snapshotsByKey: Map<string, StoredSnapshot>;
  entriesBySnapshotId: Map<string, Array<StoredEntry>>;
  refreshCalls: Array<RefreshCall>;
  nextSnapshotIdSuffix: number;
};

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createLeaderboardStoreState(): MutableLeaderboardStoreState {
  return {
    facts: [],
    profilesById: new Map<string, StoredProfile>(),
    usersById: new Map<string, StoredUser>(),
    snapshotsByKey: new Map<string, StoredSnapshot>(),
    entriesBySnapshotId: new Map<string, Array<StoredEntry>>(),
    refreshCalls: [],
    nextSnapshotIdSuffix: 1,
  };
}

function readStringParam(params: ReadonlyArray<SqlValue>, index: number, label: string): string {
  const value = params[index];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNullableHoursParam(params: ReadonlyArray<SqlValue>, index: number, label: string): number | null {
  const value = params[index];
  if (value === null) {
    return null;
  }

  if (typeof value !== "number") {
    throw new Error(`${label} must be a number or null.`);
  }

  return value;
}

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

function isNonDemoEmailOrUnknown(email: string | null): boolean {
  return email === null || !email.trim().toLowerCase().endsWith("@example.com");
}

function isSupportedClientPlatform(platform: StoredActivityPlatform): boolean {
  return platform === "web" || platform === "android" || platform === "ios";
}

function isRealClientActivityFact(fact: StoredFact): boolean {
  return fact.actorKind === "client_installation"
    && isSupportedClientPlatform(fact.platform)
    && isNonDemoEmailOrUnknown(fact.reviewedByEmail);
}

function isEligibleLeaderboardProfile(
  state: MutableLeaderboardStoreState,
  profile: StoredProfile,
): boolean {
  if (!profile.participationEnabled) {
    return false;
  }

  const user = state.usersById.get(profile.userId);
  return user !== undefined && isNonDemoEmailOrUnknown(user.email);
}

function isAllTimeSnapshotFact(fact: StoredFact, metricVersion: string, asOfMs: number): boolean {
  if (fact.metricVersion !== metricVersion || !fact.isCountable) {
    return false;
  }
  if (!isRealClientActivityFact(fact)) {
    return false;
  }

  return Date.parse(fact.reviewedAtClient) <= asOfMs;
}

function computeEligibleEntries(
  state: MutableLeaderboardStoreState,
  call: RefreshCall,
): Array<StoredEntry> {
  const asOfMs = Date.parse(call.asOfServerHour);
  const lowerBoundMs = call.lowerBoundHours === null
    ? null
    : asOfMs - call.lowerBoundHours * MILLISECONDS_PER_HOUR;

  const eligibleProfileIds = new Set<string>();
  for (const profile of state.profilesById.values()) {
    if (isEligibleLeaderboardProfile(state, profile)) {
      eligibleProfileIds.add(profile.publicProfileId);
    }
  }

  const allTimeParticipantIds = new Set<string>();
  for (const fact of state.facts) {
    if (!isAllTimeSnapshotFact(fact, call.metricVersion, asOfMs)) {
      continue;
    }

    if (eligibleProfileIds.has(fact.publicProfileId)) {
      allTimeParticipantIds.add(fact.publicProfileId);
    }
  }

  const countByProfileId = new Map<string, number>();
  for (const publicProfileId of allTimeParticipantIds) {
    countByProfileId.set(publicProfileId, 0);
  }

  for (const fact of state.facts) {
    if (!isAllTimeSnapshotFact(fact, call.metricVersion, asOfMs)) {
      continue;
    }

    const reviewedAtMs = Date.parse(fact.reviewedAtClient);
    if (lowerBoundMs !== null && reviewedAtMs <= lowerBoundMs) {
      continue;
    }
    if (!countByProfileId.has(fact.publicProfileId)) {
      continue;
    }
    countByProfileId.set(fact.publicProfileId, (countByProfileId.get(fact.publicProfileId) ?? 0) + 1);
  }

  const ranked = [...countByProfileId.entries()]
    .map(([publicProfileId, qualifiedReviewCount]) => ({ publicProfileId, qualifiedReviewCount }))
    .sort((left, right) => {
      if (left.qualifiedReviewCount !== right.qualifiedReviewCount) {
        return right.qualifiedReviewCount - left.qualifiedReviewCount;
      }

      return left.publicProfileId < right.publicProfileId ? -1 : 1;
    });

  return ranked.map((entry, index) => ({
    publicProfileId: entry.publicProfileId,
    qualifiedReviewCount: entry.qualifiedReviewCount,
    baseSortPosition: index + 1,
  }));
}

/**
 * In-memory fake of the SECURITY DEFINER community.refresh_leaderboard_snapshot function.
 * It reproduces the documented contract (countable + opted-in + non-demo, window
 * bound, tie-neutral ordering, upsert by (metric, window, hour), atomic entry replace) so
 * the production SQL string, parameter order, and orchestration are exercised offline.
 *
 * This is a two-layer strategy: the fake cannot run the real SQL offline, so the behavioural
 * tests below assert the *expected* contract against this model, and the "0059 migration ..."
 * test pins every eligibility/ordering/upsert clause in the migration itself. Together they
 * guard against the production function silently diverging from what this fake models.
 */
function createLeaderboardExecutor(state: MutableLeaderboardStoreState): DatabaseExecutor {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("community.refresh_leaderboard_snapshot(")) {
        const call: RefreshCall = {
          metricVersion: readStringParam(params, 0, "metricVersion"),
          windowKey: readStringParam(params, 1, "windowKey"),
          lowerBoundHours: readNullableHoursParam(params, 2, "lowerBoundHours"),
          asOfServerHour: readStringParam(params, 3, "asOfServerHour"),
          generatedAt: readStringParam(params, 4, "generatedAt"),
        };
        state.refreshCalls.push(call);

        const snapshotKey = [call.metricVersion, call.windowKey, call.asOfServerHour].join("\u0000");
        const existing = state.snapshotsByKey.get(snapshotKey);
        const snapshot: StoredSnapshot = existing === undefined
          ? { snapshotId: `00000000-0000-4000-8000-0000000000${String(state.nextSnapshotIdSuffix).padStart(2, "0")}`, generatedAt: call.generatedAt }
          : { snapshotId: existing.snapshotId, generatedAt: call.generatedAt };
        if (existing === undefined) {
          state.nextSnapshotIdSuffix += 1;
        }
        state.snapshotsByKey.set(snapshotKey, snapshot);
        state.entriesBySnapshotId.set(snapshot.snapshotId, computeEligibleEntries(state, call));

        return createQueryResult([{ snapshot_id: snapshot.snapshotId }]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected leaderboard snapshot query: ${text}`);
    },
  };
}

function createTransactionRunner(executor: DatabaseExecutor) {
  return async <Result>(callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>): Promise<Result> => (
    callback(executor)
  );
}

const PROFILE_A = "00000000-0000-4000-8000-00000000000a";
const PROFILE_B = "00000000-0000-4000-8000-00000000000b";
const PROFILE_C = "00000000-0000-4000-8000-00000000000c";
const PROFILE_D = "00000000-0000-4000-8000-00000000000d";
const PROFILE_E = "00000000-0000-4000-8000-00000000000e";
const PROFILE_F = "00000000-0000-4000-8000-00000000000f";
const PROFILE_G = "00000000-0000-4000-8000-000000000010";

// now 14:30 truncates to as_of 14:00 on the same UTC hour.
const NOW = new Date("2026-06-10T14:30:00.000Z");
const AS_OF = "2026-06-10T14:00:00.000Z";

function createWebClientFact(
  publicProfileId: string,
  metricVersion: string,
  isCountable: boolean,
  reviewedAtClient: string,
  reviewedByEmail: string | null,
): StoredFact {
  return {
    publicProfileId,
    metricVersion,
    isCountable,
    reviewedAtClient,
    actorKind: "client_installation",
    platform: "web",
    reviewedByEmail,
  };
}

function createSystemFact(
  publicProfileId: string,
  metricVersion: string,
  isCountable: boolean,
  reviewedAtClient: string,
  reviewedByEmail: string | null,
): StoredFact {
  return {
    publicProfileId,
    metricVersion,
    isCountable,
    reviewedAtClient,
    actorKind: "workspace_seed",
    platform: "system",
    reviewedByEmail,
  };
}

function seedLeaderboardFixture(state: MutableLeaderboardStoreState): void {
  state.profilesById.set(PROFILE_A, { publicProfileId: PROFILE_A, userId: "user-a", participationEnabled: true });
  state.profilesById.set(PROFILE_B, { publicProfileId: PROFILE_B, userId: "user-b", participationEnabled: true });
  state.profilesById.set(PROFILE_C, { publicProfileId: PROFILE_C, userId: "user-c", participationEnabled: false });
  state.profilesById.set(PROFILE_D, { publicProfileId: PROFILE_D, userId: "user-d", participationEnabled: true });
  state.profilesById.set(PROFILE_E, { publicProfileId: PROFILE_E, userId: "user-e", participationEnabled: true });
  state.profilesById.set(PROFILE_F, { publicProfileId: PROFILE_F, userId: "user-f", participationEnabled: true });
  state.profilesById.set(PROFILE_G, { publicProfileId: PROFILE_G, userId: "user-g", participationEnabled: true });

  state.usersById.set("user-a", { userId: "user-a", email: "a@real.test" });
  state.usersById.set("user-b", { userId: "user-b", email: "b@real.test" });
  state.usersById.set("user-c", { userId: "user-c", email: "c@real.test" });
  state.usersById.set("user-d", { userId: "user-d", email: null });
  state.usersById.set("user-e", { userId: "user-e", email: "demo@example.com" });
  state.usersById.set("user-f", { userId: "user-f", email: "f@real.test" });
  state.usersById.set("user-g", { userId: "user-g", email: "g@real.test" });

  const metricVersion = LEADERBOARD_SNAPSHOT_METRIC_VERSION;
  state.facts.push(
    // profile-a: 1h before as_of (in every window).
    createWebClientFact(PROFILE_A, metricVersion, true, "2026-06-10T13:00:00.000Z", "a@real.test"),
    // profile-a: again (rating 0) is never countable.
    createWebClientFact(PROFILE_A, metricVersion, false, "2026-06-10T13:30:00.000Z", "a@real.test"),
    // profile-a: 25h before as_of (excluded from 24h, included from 3 days on).
    createWebClientFact(PROFILE_A, metricVersion, true, "2026-06-09T13:00:00.000Z", "a@real.test"),
    // profile-a: exactly at as_of (included by the <= upper bound).
    createWebClientFact(PROFILE_A, metricVersion, true, "2026-06-10T14:00:00.000Z", "a@real.test"),
    // profile-a: after as_of (excluded everywhere).
    createWebClientFact(PROFILE_A, metricVersion, true, "2026-06-10T15:00:00.000Z", "a@real.test"),
    // profile-a: demo fact author activity is excluded by the public metrics email filter.
    createWebClientFact(PROFILE_A, metricVersion, true, "2026-06-10T13:15:00.000Z", "demo@example.com"),
    // profile-b: three countable reviews inside 24h.
    createWebClientFact(PROFILE_B, metricVersion, true, "2026-06-10T11:00:00.000Z", "b@real.test"),
    createWebClientFact(PROFILE_B, metricVersion, true, "2026-06-10T12:00:00.000Z", "b@real.test"),
    createWebClientFact(PROFILE_B, metricVersion, true, "2026-06-10T12:30:00.000Z", "b@real.test"),
    // profile-c: opted out of leaderboard participation.
    createWebClientFact(PROFILE_C, metricVersion, true, "2026-06-10T13:00:00.000Z", "c@real.test"),
    // profile-d: unlinked guest (email IS NULL).
    createWebClientFact(PROFILE_D, metricVersion, true, "2026-06-10T13:00:00.000Z", null),
    // profile-e: demo example.com account.
    createWebClientFact(PROFILE_E, metricVersion, true, "2026-06-10T13:00:00.000Z", "demo@example.com"),
    // profile-f: old real client activity gives all-time participation, but zero in rolling windows.
    createWebClientFact(PROFILE_F, metricVersion, true, "2026-04-01T13:00:00.000Z", "f@real.test"),
    // profile-g: again and system facts do not count, so the opted-in non-demo profile is excluded.
    createWebClientFact(PROFILE_G, metricVersion, false, "2026-06-10T13:00:00.000Z", "g@real.test"),
    createSystemFact(PROFILE_G, metricVersion, true, "2026-06-10T13:15:00.000Z", "g@real.test"),
    createWebClientFact(PROFILE_F, metricVersion, false, "2026-06-10T13:00:00.000Z", "f@real.test"),
    createSystemFact(PROFILE_F, metricVersion, true, "2026-06-10T13:15:00.000Z", "f@real.test"),
  );
}

function generateWithFake(
  state: MutableLeaderboardStoreState,
  metricVersion: string,
  now: Date,
) {
  const executor = createLeaderboardExecutor(state);
  return generateLeaderboardSnapshotsWithDependencies({
    metricVersion,
    now: () => now,
    withTransactionFn: createTransactionRunner(executor),
    refreshLeaderboardSnapshotFn: refreshLeaderboardSnapshotInExecutor,
  });
}

function entriesForWindow(state: MutableLeaderboardStoreState, windowKey: string): ReadonlyArray<StoredEntry> {
  const snapshotKey = [LEADERBOARD_SNAPSHOT_METRIC_VERSION, windowKey, AS_OF].join("\u0000");
  const snapshot = state.snapshotsByKey.get(snapshotKey);
  if (snapshot === undefined) {
    throw new Error(`No snapshot stored for window ${windowKey}.`);
  }

  return state.entriesBySnapshotId.get(snapshot.snapshotId) ?? [];
}

test("LEADERBOARD_WINDOWS encodes window lower bounds as exact hours from as_of_server_hour", () => {
  assert.deepEqual(
    LEADERBOARD_WINDOWS.map((window) => [window.windowKey, window.lowerBoundHours]),
    [
      ["last_24_hours", 24],
      ["last_3_days", 72],
      ["last_7_days", 168],
      ["last_30_days", 720],
      ["all_time", null],
    ],
  );
});

test("truncateToServerHour drops minutes and seconds to the UTC hour", () => {
  assert.equal(truncateToServerHour(NOW).toISOString(), AS_OF);
});

test("generateLeaderboardSnapshots refreshes every window once with the matching window bound", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  const result = await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);

  assert.equal(result.metricVersion, LEADERBOARD_SNAPSHOT_METRIC_VERSION);
  assert.equal(result.generatedAt, NOW.toISOString());
  assert.equal(result.asOfServerHour, AS_OF);
  assert.deepEqual(result.windows.map((window) => window.windowKey), [
    "last_24_hours",
    "last_3_days",
    "last_7_days",
    "last_30_days",
    "all_time",
  ]);

  assert.deepEqual(
    state.refreshCalls.map((call) => [call.windowKey, call.lowerBoundHours]),
    [
      ["last_24_hours", 24],
      ["last_3_days", 72],
      ["last_7_days", 168],
      ["last_30_days", 720],
      ["all_time", null],
    ],
  );
  for (const call of state.refreshCalls) {
    assert.equal(call.metricVersion, LEADERBOARD_SNAPSHOT_METRIC_VERSION);
    assert.equal(call.asOfServerHour, AS_OF);
    assert.equal(call.generatedAt, NOW.toISOString());
  }
});

test("last_24_hours snapshot includes all-time-active participants even with zero window reviews", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);

  // profile-b has 3 countable reviews in 24h; profile-a has 2 (1h-before plus the as_of
  // boundary fact); the again fact, the 25h fact, and the future fact are all excluded.
  // profile-d is an unlinked guest and still appears as an anonymized participant.
  // profile-f has all-time real client activity, so it appears with zero reviews in this window.
  assert.deepEqual(entriesForWindow(state, "last_24_hours"), [
    { publicProfileId: PROFILE_B, qualifiedReviewCount: 3, baseSortPosition: 1 },
    { publicProfileId: PROFILE_A, qualifiedReviewCount: 2, baseSortPosition: 2 },
    { publicProfileId: PROFILE_D, qualifiedReviewCount: 1, baseSortPosition: 3 },
    { publicProfileId: PROFILE_F, qualifiedReviewCount: 0, baseSortPosition: 4 },
  ]);
});

test("all_time snapshot includes older reviews and breaks count ties by public_profile_id ascending", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);

  // all_time adds profile-a's 25h fact, so both profiles reach 3; the tie resolves to
  // public_profile_id ascending, putting profile-a first.
  assert.deepEqual(entriesForWindow(state, "all_time"), [
    { publicProfileId: PROFILE_A, qualifiedReviewCount: 3, baseSortPosition: 1 },
    { publicProfileId: PROFILE_B, qualifiedReviewCount: 3, baseSortPosition: 2 },
    { publicProfileId: PROFILE_D, qualifiedReviewCount: 1, baseSortPosition: 3 },
    { publicProfileId: PROFILE_F, qualifiedReviewCount: 1, baseSortPosition: 4 },
  ]);
});

test("opted-out, demo, and all-time-zero profiles are excluded while unlinked guests participate", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);

  const excludedProfileIds = new Set([PROFILE_C, PROFILE_E, PROFILE_G]);
  for (const window of LEADERBOARD_WINDOWS) {
    const profileIdsInWindow = entriesForWindow(state, window.windowKey).map((entry) => entry.publicProfileId);
    for (const excludedProfileId of excludedProfileIds) {
      assert.equal(
        profileIdsInWindow.includes(excludedProfileId),
        false,
        `${excludedProfileId} must not appear in ${window.windowKey}`,
      );
    }
    assert.equal(profileIdsInWindow.includes(PROFILE_D), true, `${PROFILE_D} must appear in ${window.windowKey}`);
    assert.equal(profileIdsInWindow.includes(PROFILE_F), true, `${PROFILE_F} must appear in ${window.windowKey}`);
  }
});

test("every window uses the same eligible participant universe", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);

  const expectedProfileIds = [PROFILE_A, PROFILE_B, PROFILE_D, PROFILE_F].sort();
  for (const window of LEADERBOARD_WINDOWS) {
    const profileIdsInWindow = entriesForWindow(state, window.windowKey)
      .map((entry) => entry.publicProfileId)
      .sort();
    assert.deepEqual(profileIdsInWindow, expectedProfileIds, window.windowKey);
  }
});

test("regenerating the same server hour reuses snapshots and replaces entries idempotently", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  const firstRun = await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);
  const secondRun = await generateWithFake(state, LEADERBOARD_SNAPSHOT_METRIC_VERSION, NOW);

  assert.deepEqual(
    secondRun.windows.map((window) => window.snapshotId),
    firstRun.windows.map((window) => window.snapshotId),
  );
  // Five window snapshots total, not ten, after two runs of the same hour.
  assert.equal(state.snapshotsByKey.size, 5);
  // Entries are replaced, never duplicated.
  assert.deepEqual(entriesForWindow(state, "last_24_hours"), [
    { publicProfileId: PROFILE_B, qualifiedReviewCount: 3, baseSortPosition: 1 },
    { publicProfileId: PROFILE_A, qualifiedReviewCount: 2, baseSortPosition: 2 },
    { publicProfileId: PROFILE_D, qualifiedReviewCount: 1, baseSortPosition: 3 },
    { publicProfileId: PROFILE_F, qualifiedReviewCount: 0, baseSortPosition: 4 },
  ]);
});

test("generateLeaderboardSnapshots rejects an unsupported metric version before touching the database", async () => {
  const state = createLeaderboardStoreState();
  seedLeaderboardFixture(state);

  await assert.rejects(
    generateWithFake(state, "qualified_reviews_v2", NOW),
    UnsupportedLeaderboardMetricVersionError,
  );
  assert.equal(state.refreshCalls.length, 0);
});

test("production leaderboard snapshot generation uses one repeatable-read transaction", () => {
  const sourcePath = resolve(
    process.cwd(),
    "src/community/leaderboard/leaderboardSnapshots.ts",
  );
  const source = readFileSync(sourcePath, "utf8").replace(/\s+/g, " ");

  assert.match(source, /import \{ unsafeRepeatableReadTransaction \} from "\.\.\/\.\.\/database\/unsafe"/);
  assert.match(source, /withTransactionFn: unsafeRepeatableReadTransaction/);
});

test("community leaderboard snapshot Lambda retries transient database failures", () => {
  const sourcePath = resolve(
    process.cwd(),
    "src/entrypoints/lambda-community-leaderboard-snapshot.ts",
  );
  const source = readFileSync(sourcePath, "utf8").replace(/\s+/g, " ");

  assert.match(source, /import \{ withTransientDatabaseRetry \} from "\.\.\/database\/transient"/);
  assert.match(source, /const result = await withTransientDatabaseRetry\( \(\) => runtime\.generateLeaderboardSnapshots\(\), \(\) => observationScope, \)/);
});

test("assertLeaderboardWindowKey accepts known keys and rejects unknown ones", () => {
  assert.equal(assertLeaderboardWindowKey("last_7_days"), "last_7_days");
  assert.throws(() => assertLeaderboardWindowKey("last_year"), InvalidLeaderboardWindowKeyError);
});

test("0059 migration creates leaderboard snapshot tables and the privileged refresh function", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0059_leaderboard_snapshots.sql",
  );
  // Collapse every whitespace run to a single space so these contract checks survive
  // harmless reformatting (line breaks, indentation, aligned columns) and only fail when the
  // SQL contract itself changes.
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  // Snapshot header table, keyed and uniquely constrained per metric/window/server-hour.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS community\.leaderboard_snapshots/);
  assert.match(sql, /snapshot_id UUID PRIMARY KEY/);
  assert.match(sql, /metric_version TEXT NOT NULL/);
  assert.match(sql, /window_key TEXT NOT NULL/);
  assert.match(sql, /generated_at TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /as_of_server_hour TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /UNIQUE \(metric_version, window_key, as_of_server_hour\)/);

  // Entries table with cascading references and the composite primary key.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS community\.leaderboard_snapshot_entries/);
  assert.match(sql, /snapshot_id UUID NOT NULL REFERENCES community\.leaderboard_snapshots\(snapshot_id\) ON DELETE CASCADE/);
  assert.match(sql, /public_profile_id UUID NOT NULL REFERENCES community\.public_profiles\(public_profile_id\) ON DELETE CASCADE/);
  assert.match(sql, /qualified_review_count INTEGER NOT NULL/);
  assert.match(sql, /base_sort_position INTEGER NOT NULL/);
  assert.match(sql, /PRIMARY KEY \(snapshot_id, public_profile_id\)/);

  // Indexes: latest-per-window lookup and ordered in-snapshot reads.
  assert.match(sql, /idx_leaderboard_snapshots_metric_window_as_of ON community\.leaderboard_snapshots\(metric_version, window_key, as_of_server_hour DESC\)/);
  assert.match(sql, /idx_leaderboard_snapshot_entries_snapshot_rank ON community\.leaderboard_snapshot_entries\(snapshot_id, qualified_review_count DESC, base_sort_position ASC\)/);
  // The (snapshot_id, public_profile_id) lookup is served by the primary key, so no
  // separate redundant index is created.
  assert.match(sql, /already served by the primary key index/);
  assert.equal(/CREATE INDEX[^;]*leaderboard_snapshot_entries\(snapshot_id, public_profile_id\)/.test(sql), false);

  // Row level security: read-only access for backend_app, no direct write grant.
  assert.match(sql, /ALTER TABLE community\.leaderboard_snapshots ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE community\.leaderboard_snapshot_entries ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT ON TABLE community\.leaderboard_snapshots TO backend_app/);
  assert.match(sql, /GRANT SELECT ON TABLE community\.leaderboard_snapshot_entries TO backend_app/);
  assert.match(sql, /CREATE POLICY leaderboard_snapshots_backend_select_runtime/);
  assert.equal(/GRANT (INSERT|UPDATE|DELETE)[^;]*leaderboard_snapshot/.test(sql), false);

  // SECURITY DEFINER refresh function with the eligibility filters and atomic replace.
  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.refresh_leaderboard_snapshot/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog, public/);
  assert.match(sql, /ON CONFLICT \(metric_version, window_key, as_of_server_hour\)/);
  assert.match(sql, /DELETE FROM community\.leaderboard_snapshot_entries/);
  assert.match(sql, /facts\.is_countable = TRUE/);
  assert.match(sql, /facts\.reviewed_at_client <= p_as_of_server_hour/);
  assert.match(sql, /facts\.reviewed_at_client > p_as_of_server_hour - \(p_window_lower_bound_hours \* interval '1 hour'\)/);
  assert.match(sql, /profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /user_settings\.email IS NOT NULL/);
  assert.match(sql, /NOT LIKE '%@example\.com'/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \( ORDER BY eligible\.qualified_review_count DESC, eligible\.public_profile_id ASC \)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.refresh_leaderboard_snapshot\(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ\) TO backend_app/);

  // Display names are never stored in snapshots; they are derived at read time.
  assert.equal(sql.includes("display_name"), false);
});

test("0060 migration includes zero-count linked opted-in profiles in snapshots", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0060_leaderboard_zero_count_participants.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.refresh_leaderboard_snapshot/);
  assert.match(sql, /FROM community\.public_profiles AS profiles/);
  assert.match(sql, /INNER JOIN org\.user_settings AS user_settings/);
  assert.match(sql, /LEFT JOIN community\.public_review_activity_facts AS facts/);
  assert.match(sql, /COUNT\(facts\.public_profile_id\)::int AS qualified_review_count/);
  assert.match(sql, /profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /user_settings\.email IS NOT NULL/);
  assert.match(sql, /NOT LIKE '%@example\.com'/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \( ORDER BY eligible\.qualified_review_count DESC, eligible\.public_profile_id ASC \)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.refresh_leaderboard_snapshot\(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ\) TO backend_app/);
});

test("0061 migration counts only real client-app activity without shrinking the participant universe", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0061_leaderboard_real_client_activity.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.refresh_leaderboard_snapshot/);
  assert.match(sql, /FROM community\.public_profiles AS profiles/);
  assert.match(sql, /LEFT JOIN \( SELECT facts\.public_profile_id FROM community\.public_review_activity_facts AS facts/);
  assert.match(sql, /INNER JOIN content\.review_events AS review_events/);
  assert.match(sql, /INNER JOIN sync\.workspace_replicas AS workspace_replicas/);
  assert.match(sql, /ON fact_user_settings\.user_id = facts\.reviewed_by_user_id/);
  assert.match(sql, /workspace_replicas\.actor_kind = 'client_installation'/);
  assert.match(sql, /workspace_replicas\.platform IN \('web', 'android', 'ios'\)/);
  assert.match(sql, /fact_user_settings\.email IS NULL OR LOWER\(btrim\(fact_user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.match(sql, /COUNT\(countable_facts\.public_profile_id\)::int AS qualified_review_count/);
  assert.match(sql, /profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /user_settings\.email IS NOT NULL/);
  assert.match(sql, /LOWER\(btrim\(user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.refresh_leaderboard_snapshot\(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ\) TO backend_app/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.read_current_user_latest_leaderboard_review/);
  assert.match(sql, /WHERE facts\.reviewed_by_user_id = security\.current_user_id\(\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.read_current_user_latest_leaderboard_review\(TEXT\) TO backend_app/);
});

test("0062 migration includes unlinked guest public profiles in snapshots", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0062_leaderboard_guest_participants.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.refresh_leaderboard_snapshot/);
  assert.match(sql, /FROM community\.public_profiles AS profiles/);
  assert.match(sql, /LEFT JOIN \( SELECT facts\.public_profile_id FROM community\.public_review_activity_facts AS facts/);
  assert.match(sql, /fact_user_settings\.email IS NULL OR LOWER\(btrim\(fact_user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.match(sql, /COUNT\(countable_facts\.public_profile_id\)::int AS qualified_review_count/);
  assert.match(sql, /profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /user_settings\.email IS NULL OR LOWER\(btrim\(user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.equal(/user_settings\.email IS NOT NULL/.test(sql), false);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.refresh_leaderboard_snapshot\(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ\) TO backend_app/);
});

test("0071 migration limits snapshots to all-time-active participants while preserving zero window counts", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0071_progress_leaderboard_all_time_participants.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.refresh_leaderboard_snapshot/);
  assert.match(sql, /WITH real_countable_facts AS \( SELECT facts\.public_profile_id, facts\.reviewed_at_client FROM community\.public_review_activity_facts AS facts/);
  assert.match(sql, /INNER JOIN content\.review_events AS review_events/);
  assert.match(sql, /INNER JOIN sync\.workspace_replicas AS workspace_replicas/);
  assert.match(sql, /facts\.metric_version = p_metric_version/);
  assert.match(sql, /facts\.is_countable = TRUE/);
  assert.match(sql, /facts\.reviewed_at_client <= p_as_of_server_hour/);
  assert.match(sql, /workspace_replicas\.actor_kind = 'client_installation'/);
  assert.match(sql, /workspace_replicas\.platform IN \('web', 'android', 'ios'\)/);
  assert.match(sql, /fact_user_settings\.email IS NULL OR LOWER\(btrim\(fact_user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.match(sql, /all_time_participants AS \( SELECT DISTINCT real_countable_facts\.public_profile_id FROM real_countable_facts \)/);
  assert.match(sql, /INNER JOIN all_time_participants ON all_time_participants\.public_profile_id = profiles\.public_profile_id/);
  assert.match(sql, /LEFT JOIN real_countable_facts AS window_facts ON window_facts\.public_profile_id = profiles\.public_profile_id AND \( p_window_lower_bound_hours IS NULL OR window_facts\.reviewed_at_client > p_as_of_server_hour - \(p_window_lower_bound_hours \* interval '1 hour'\) \)/);
  assert.match(sql, /COUNT\(window_facts\.public_profile_id\)::int AS qualified_review_count/);
  assert.match(sql, /profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /user_settings\.email IS NULL OR LOWER\(btrim\(user_settings\.email\)\) NOT LIKE '%@example\.com'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.refresh_leaderboard_snapshot\(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ\) TO backend_app/);
});
