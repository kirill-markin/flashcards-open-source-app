import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor } from "../../database";
import { loadLeaderboardProfileInExecutor } from "./leaderboardProfile";
import { loadProgressLeaderboardInExecutor } from "./progress/progressLeaderboard";
import {
  LEADERBOARD_SNAPSHOT_METRIC_VERSION,
  LEADERBOARD_WINDOW_KEYS,
} from "./progress/leaderboardWindows";
import { loadStreakLeaderboardInExecutor } from "./streak/streakLeaderboard";
import { STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION } from "./streak/streakLeaderboardSnapshots";

function executorFor(client: pg.Client): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

test("profile aliases preserve requested identities and live opt-out filters stale snapshot ranks", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (ownerUrl === undefined || ownerUrl === "") throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const client = new pg.Client({ connectionString: ownerUrl });
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const profiles = [randomUUID(), randomUUID(), randomUUID()];
  const alias = randomUUID();
  const invitationId = randomUUID();
  const generatedAt = new Date("2040-01-01T12:00:00.000Z");
  const request = { userId: users[0], transport: "session" as const, localeHint: "en" };
  const executor = executorFor(client);
  try {
    await client.connect();
    await client.query("BEGIN");
    for (const [index, userId] of users.entries()) {
      await client.query("INSERT INTO org.user_settings(user_id, progress_time_zone) VALUES ($1, 'UTC')", [userId]);
      await client.query(
        "INSERT INTO community.public_profiles(user_id, public_profile_id) VALUES ($1, $2)",
        [userId, profiles[index]],
      );
    }
    await client.query(
      `INSERT INTO progress.user_active_review_days
         (reviewed_by_user_id, local_date, review_count, first_reviewed_at_client,
          last_reviewed_at_client, time_zone, time_zone_source)
       VALUES ($1, '2040-01-01', 4, $2, $2, 'UTC', 'client')`,
      [users[1], generatedAt],
    );
    await client.query(
      `INSERT INTO community.friend_invitations
         (friend_invitation_id, inviter_user_id, invite_token_hash, invitee_display_name_for_inviter, expires_at)
       VALUES ($1, $2, $3, 'Current friend', now() + interval '1 day')`,
      [invitationId, users[0], createHash("sha256").update(invitationId).digest("hex")],
    );
    await client.query(
      `INSERT INTO community.friendships
         (viewer_user_id, friend_user_id, friend_public_profile_id, friend_display_name, created_from_invitation_id)
       VALUES ($1, $2, $3, 'Current friend', $4)`,
      [users[0], users[1], profiles[1], invitationId],
    );
    for (const windowKey of LEADERBOARD_WINDOW_KEYS) {
      const snapshotId = randomUUID();
      await client.query(
        `INSERT INTO community.leaderboard_snapshots
           (snapshot_id, metric_version, window_key, generated_at, as_of_server_hour)
         VALUES ($1, $2, $3, $4, $4)`,
        [snapshotId, LEADERBOARD_SNAPSHOT_METRIC_VERSION, windowKey, generatedAt],
      );
      for (const [index, profileId] of [profiles[2], profiles[1], profiles[0]].entries()) {
        await client.query(
          `INSERT INTO community.leaderboard_snapshot_entries
             (snapshot_id, public_profile_id, qualified_review_count, base_sort_position)
           VALUES ($1, $2, $3, $4)`,
          [snapshotId, profileId, 30 - index * 10, index + 1],
        );
      }
    }
    const streakSnapshotId = randomUUID();
    await client.query(
      `INSERT INTO community.streak_leaderboard_snapshots
         (snapshot_id, metric_version, as_of_utc_date, generated_at)
       VALUES ($1, $2, '2040-01-01', $3)`,
      [streakSnapshotId, STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION, generatedAt],
    );
    for (const [index, profileId] of [profiles[2], profiles[1], profiles[0]].entries()) {
      await client.query(
        `INSERT INTO community.streak_leaderboard_snapshot_entries
           (snapshot_id, public_profile_id, streak_days, base_sort_position) VALUES ($1, $2, $3, $4)`,
        [streakSnapshotId, profileId, 30 - index * 10, index + 1],
      );
    }

    await client.query("SET LOCAL ROLE backend_app");
    const canonical = await loadLeaderboardProfileInExecutor(executor, { ...request, publicProfileId: profiles[1] }, generatedAt);
    assert.equal(canonical.status, "ready");
    assert.equal((await client.query<{ allowed: boolean }>(
      "SELECT has_table_privilege(current_user, 'community.public_profile_aliases', 'SELECT') AS allowed",
    )).rows[0].allowed, false);
    await client.query("RESET ROLE");
    await client.query(
      "INSERT INTO community.public_profile_aliases(alias_public_profile_id, canonical_public_profile_id) VALUES ($1, $2)",
      [alias, profiles[1]],
    );
    await client.query("SET LOCAL ROLE backend_app");
    const aliased = await loadLeaderboardProfileInExecutor(executor, { ...request, publicProfileId: alias }, generatedAt);
    assert.deepEqual(aliased, { ...canonical, publicProfileId: alias });
    if (aliased.status !== "ready") throw new Error("Expected ready aliased profile");
    assert.equal(aliased.friendDisplayName, "Current friend");
    assert.equal(aliased.metrics.currentStreakDays, 20);
    assert.equal(aliased.metrics.bestRatingPlacement?.rank, 2);
    assert.equal(aliased.reviewActivity.days.at(-1)?.reviewCount, 4);

    await client.query("RESET ROLE");
    await client.query("UPDATE community.public_profiles SET leaderboard_participation_enabled = FALSE WHERE user_id = $1", [users[2]]);
    await client.query("SET LOCAL ROLE backend_app");
    const progress = await loadProgressLeaderboardInExecutor(executor, request, generatedAt);
    assert.equal(progress.status, "ready");
    for (const window of progress.windows) {
      assert.equal(window.participantCount, 2);
      assert.deepEqual(window.rankingRows.map((row) => [row.publicProfileId, row.rank]), [[profiles[1], 1], [profiles[0], 2]]);
    }
    const streak = await loadStreakLeaderboardInExecutor(executor, request);
    assert.equal(streak.status, "ready");
    if (streak.status !== "ready") throw new Error("Expected ready streak leaderboard");
    assert.equal(streak.participantCount, 2);
    assert.deepEqual(streak.rankingRows.map((row) => [row.publicProfileId, row.rank]), [[profiles[1], 1], [profiles[0], 2]]);
    const filtered = await loadLeaderboardProfileInExecutor(executor, { ...request, publicProfileId: alias }, generatedAt);
    if (filtered.status !== "ready") throw new Error("Expected ready filtered profile");
    assert.equal(filtered.metrics.bestRatingPlacement?.rank, 1);
    assert.deepEqual(await loadLeaderboardProfileInExecutor(executor, { ...request, publicProfileId: profiles[2] }, generatedAt), { status: "profile_unavailable" });

    await client.query("RESET ROLE");
    await client.query("UPDATE community.public_profiles SET leaderboard_participation_enabled = FALSE WHERE user_id = $1", [users[1]]);
    await client.query("SET LOCAL ROLE backend_app");
    for (const publicProfileId of [alias, profiles[1], randomUUID()]) {
      assert.deepEqual(await loadLeaderboardProfileInExecutor(executor, { ...request, publicProfileId }, generatedAt), { status: "profile_unavailable" });
    }
    const optedOutProgress = await loadProgressLeaderboardInExecutor(executor, request, generatedAt);
    for (const window of optedOutProgress.windows) {
      assert.deepEqual(window.rankingRows.map((row) => [row.publicProfileId, row.rank]), [[profiles[0], 1]]);
    }
    const optedOutStreak = await loadStreakLeaderboardInExecutor(executor, request);
    if (optedOutStreak.status !== "ready") throw new Error("Expected ready leaderboard with opted-out friend filtered");
    assert.deepEqual(optedOutStreak.rankingRows.map((row) => [row.publicProfileId, row.rank]), [[profiles[0], 1]]);

    await client.query("RESET ROLE");
    await client.query("UPDATE community.public_profiles SET leaderboard_participation_enabled = FALSE WHERE user_id = $1", [users[0]]);
    await client.query("SET LOCAL ROLE backend_app");
    assert.equal((await loadProgressLeaderboardInExecutor(executor, request, generatedAt)).status, "participation_disabled");
    assert.equal((await loadStreakLeaderboardInExecutor(executor, request)).status, "participation_disabled");
    assert.deepEqual(await loadLeaderboardProfileInExecutor(executor, { ...request, publicProfileId: alias }, generatedAt), { status: "participation_disabled" });
    await client.query("RESET ROLE");
    await client.query("DELETE FROM community.public_profiles WHERE user_id = $1", [users[1]]);
    assert.equal((await client.query<{ count: number }>("SELECT count(*)::int AS count FROM community.public_profile_aliases WHERE alias_public_profile_id = $1", [alias])).rows[0].count, 0);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
