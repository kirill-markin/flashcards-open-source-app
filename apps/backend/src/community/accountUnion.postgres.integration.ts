import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../database";

const transfer = "SELECT community.transfer_account_community($1, $2)";
const retire = "SELECT auth.record_account_retirement($1, $2, $3)";
const tokenHash = (value: string): string => createHash("sha256").update(value).digest("hex");

function clientForOwner(): pg.Client {
  const url = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (url === undefined || url === "") throw new Error("TEST_DATABASE_ADMIN_URL is required");
  return new pg.Client({ connectionString: url });
}

function executorFor(client: pg.Client): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

async function seedAccount(client: pg.Client, userId: string, profileId: string | null): Promise<void> {
  await client.query("INSERT INTO org.user_settings(user_id, progress_time_zone) VALUES ($1, 'UTC')", [userId]);
  if (profileId !== null) {
    await client.query("INSERT INTO community.public_profiles(user_id, public_profile_id) VALUES ($1, $2)", [userId, profileId]);
  }
}

async function seedInvitation(client: pg.Client, inviter: string, invitationId: string): Promise<void> {
  await client.query(`INSERT INTO community.friend_invitations
    (friend_invitation_id, inviter_user_id, invite_token_hash, invitee_display_name_for_inviter, expires_at)
    VALUES ($1, $2, $3, 'Inviter private label', now() + interval '1 day')`,
  [invitationId, inviter, tokenHash(invitationId)]);
}

async function seedPair(client: pg.Client, users: ReadonlyArray<string>, profiles: ReadonlyArray<string>, label: string): Promise<void> {
  const invitationId = randomUUID();
  await seedInvitation(client, users[0], invitationId);
  await client.query("UPDATE community.friend_invitations SET accepted_at = now(), accepted_by_user_id = $2 WHERE friend_invitation_id = $1", [invitationId, users[1]]);
  for (const [viewer, friend] of [[0, 1], [1, 0]]) {
    await client.query(`INSERT INTO community.friendships
      (viewer_user_id, friend_user_id, friend_public_profile_id, friend_display_name, created_from_invitation_id)
      VALUES ($1, $2, $3, $4, $5)`, [users[viewer], users[friend], profiles[friend], `${label} ${viewer}`, invitationId]);
  }
}

test("private community union preserves review facts, private graph winners, flat aliases and live refusal", async () => {
  const client = clientForOwner();
  const [source, target, friend, unique, later, joiner] = Array.from({ length: 6 }, () => randomUUID());
  const users = [source, target, friend, unique, later, joiner];
  const profiles = users.map(() => randomUUID());
  const oldAlias = randomUUID();
  const pendingInvite = randomUUID();
  const workspaceId = randomUUID();
  const replicaId = randomUUID();
  const cardId = randomUUID();
  const eventIds = Array.from({ length: 4 }, () => randomUUID()).sort();
  const generatedAt = "2040-01-02T12:00:00.000Z";
  try {
    await client.connect();
    await client.query("BEGIN");
    for (const [index, userId] of users.entries()) await seedAccount(client, userId, profiles[index]);
    await client.query("INSERT INTO community.public_profile_aliases VALUES ($1, $2)", [oldAlias, profiles[0]]);
    await client.query("UPDATE community.public_profiles SET leaderboard_participation_enabled = FALSE WHERE user_id = $1", [source]);
    await seedPair(client, [source, friend], [profiles[0], profiles[2]], "Source");
    await seedPair(client, [target, friend], [profiles[1], profiles[2]], "Canonical");
    await seedPair(client, [source, unique], [profiles[0], profiles[3]], "Unique");
    await seedPair(client, [source, target], [profiles[0], profiles[1]], "Self after union");
    await seedInvitation(client, source, pendingInvite);
    const invitationsBefore = (await client.query(`SELECT friend_invitation_id,
      to_jsonb(invitation) - 'inviter_user_id' - 'accepted_by_user_id' AS retained
      FROM community.friend_invitations AS invitation WHERE inviter_user_id = ANY($1::text[]) ORDER BY friend_invitation_id`, [users])).rows;
    const edgesBefore = (await client.query("SELECT * FROM community.friendships WHERE viewer_user_id = $1 OR friend_user_id = $1 ORDER BY viewer_user_id, friend_user_id", [target])).rows;
    await client.query(`INSERT INTO org.workspaces
      (workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id)
      VALUES ($1, 'Historical reviews', now(), $2, 'seed')`, [workspaceId, replicaId]);
    await client.query(`INSERT INTO sync.workspace_replicas
      (replica_id, workspace_id, user_id, actor_kind, actor_key, platform)
      VALUES ($1, $2, $3, 'workspace_seed', 'seed', 'system')`, [replicaId, workspaceId, source]);
    await client.query(`INSERT INTO content.cards
      (card_id, workspace_id, front_text, back_text, metadata, created_at, client_updated_at, last_modified_by_replica_id, last_operation_id)
      VALUES ($1, $2, 'Question', 'Answer', '{"version":1,"source":null}', now(), now(), $3, 'seed')`, [cardId, workspaceId, replicaId]);
    const cardBefore = (await client.query("SELECT to_jsonb(card) AS retained FROM content.cards AS card WHERE card_id = $1", [cardId])).rows;
    for (const [index, eventId] of eventIds.entries()) {
      const author = index === 1 ? target : source;
      const profile = author === source ? profiles[0] : profiles[1];
      await client.query(`INSERT INTO content.review_events
        (review_event_id, workspace_id, card_id, replica_id, client_event_id, rating,
         reviewed_by_user_id, reviewed_at_client, reviewed_time_zone, reviewed_local_date, reviewed_time_zone_source)
        VALUES ($1::uuid, $2, $3, $4, $1::text, $5, $6, '2040-01-01T12:00:00Z', $7, $8, $9)`,
      [eventId, workspaceId, cardId, replicaId, index, author,
        index === 3 ? null : index === 0 ? "America/New_York" : "UTC",
        index === 3 ? null : index === 2 ? "2040-01-02" : "2040-01-01", index === 3 ? null : "client"]);
      await client.query(`INSERT INTO community.public_review_activity_facts
        (review_event_id, metric_version, public_profile_id, reviewed_by_user_id, rating,
         reviewed_at_client, reviewed_at_server, is_countable, exclusion_reason)
        SELECT review_event_id, 'qualified_reviews_v1', $2, reviewed_by_user_id, rating,
          reviewed_at_client, reviewed_at_server, rating <> 0, CASE WHEN rating = 0 THEN 'again' ELSE NULL END
        FROM content.review_events WHERE review_event_id = $1`, [eventId, profile]);
    }
    const reviewsBefore = (await client.query(`SELECT to_jsonb(event) - 'reviewed_by_user_id' AS retained
      FROM content.review_events AS event WHERE workspace_id = $1 ORDER BY review_event_id`, [workspaceId])).rows;
    const factsBefore = (await client.query(`SELECT to_jsonb(fact) - 'reviewed_by_user_id' - 'public_profile_id' AS retained
      FROM community.public_review_activity_facts AS fact WHERE review_event_id = ANY($1::uuid[]) ORDER BY review_event_id`, [eventIds])).rows;
    await client.query(`INSERT INTO progress.user_active_review_days
      (reviewed_by_user_id, local_date, review_count, first_reviewed_at_client, last_reviewed_at_client, time_zone, time_zone_source)
      VALUES ($1, '2040-01-01', 100, now(), now(), 'UTC', 'client'), ($2, '2040-01-01', 200, now(), now(), 'UTC', 'client')`, [source, target]);
    const ratingSnapshot = randomUUID();
    const streakSnapshot = randomUUID();
    await client.query(`INSERT INTO community.leaderboard_snapshots
      (snapshot_id, metric_version, window_key, generated_at, as_of_server_hour)
      VALUES ($1, 'qualified_reviews_v1', 'all_time', $2, $2)`, [ratingSnapshot, generatedAt]);
    await client.query(`INSERT INTO community.streak_leaderboard_snapshots
      (snapshot_id, metric_version, as_of_utc_date, generated_at) VALUES ($1, 'streak_days_v1', '2040-01-02', $2)`, [streakSnapshot, generatedAt]);
    for (const [index, profileId] of profiles.slice(0, 3).entries()) {
      await client.query("INSERT INTO community.leaderboard_snapshot_entries VALUES ($1, $2, 20, $3)", [ratingSnapshot, profileId, index + 1]);
      await client.query("INSERT INTO community.streak_leaderboard_snapshot_entries VALUES ($1, $2, 20, $3)", [streakSnapshot, profileId, index + 1]);
    }
    for (const role of ["backend_app", "auth_app", "reporting_readonly"]) {
      await client.query("SAVEPOINT runtime_grant");
      await client.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(client.query(transfer, [source, target]), { code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT runtime_grant");
    }
    await client.query(transfer, [source, target]);
    await client.query(retire, [source, target, randomUUID()]);
    assert.deepEqual((await client.query(`SELECT to_jsonb(event) - 'reviewed_by_user_id' AS retained
      FROM content.review_events AS event WHERE workspace_id = $1 ORDER BY review_event_id`, [workspaceId])).rows, reviewsBefore);
    assert.deepEqual((await client.query(`SELECT to_jsonb(fact) - 'reviewed_by_user_id' - 'public_profile_id' AS retained
      FROM community.public_review_activity_facts AS fact WHERE review_event_id = ANY($1::uuid[]) ORDER BY review_event_id`, [eventIds])).rows, factsBefore);
    assert.deepEqual((await client.query("SELECT to_jsonb(card) AS retained FROM content.cards AS card WHERE card_id = $1", [cardId])).rows, cardBefore);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM content.review_events WHERE reviewed_by_user_id = $1", [target])).rows[0].count, 4);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community.public_review_activity_facts WHERE reviewed_by_user_id = $1 AND public_profile_id = $2", [target, profiles[1]])).rows[0].count, 4);
    assert.deepEqual((await client.query(`SELECT local_date::text, review_count, time_zone FROM progress.user_active_review_days
      WHERE reviewed_by_user_id = $1 ORDER BY local_date`, [target])).rows, [
      { local_date: "2040-01-01", review_count: 2, time_zone: "America/New_York" },
      { local_date: "2040-01-02", review_count: 1, time_zone: "UTC" },
    ]);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM progress.user_active_review_days WHERE reviewed_by_user_id = $1", [source])).rows[0].count, 0);
    const canonicalEdges = edgesBefore.filter((row) => row.viewer_user_id !== source && row.friend_user_id !== source);
    for (const row of canonicalEdges) {
      assert.deepEqual((await client.query("SELECT * FROM community.friendships WHERE viewer_user_id = $1 AND friend_user_id = $2", [row.viewer_user_id, row.friend_user_id])).rows[0], row);
    }
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community.friendships WHERE viewer_user_id = $1 OR friend_user_id = $1", [source])).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community.friendships WHERE viewer_user_id = $1 OR friend_user_id = $1", [target])).rows[0].count, 4);
    assert.deepEqual((await client.query(`SELECT viewer_user_id, friend_user_id, friend_display_name, friend_public_profile_id
      FROM community.friendships WHERE viewer_user_id = $1 AND friend_user_id = $2`, [target, unique])).rows, [
      { viewer_user_id: target, friend_user_id: unique, friend_display_name: "Unique 0", friend_public_profile_id: profiles[3] },
    ]);
    assert.deepEqual((await client.query(`SELECT friend_display_name, friend_public_profile_id FROM community.friendships
      WHERE viewer_user_id = $1 AND friend_user_id = $2`, [unique, target])).rows, [
      { friend_display_name: "Unique 1", friend_public_profile_id: profiles[1] },
    ]);
    assert.deepEqual((await client.query(`SELECT friend_invitation_id,
      to_jsonb(invitation) - 'inviter_user_id' - 'accepted_by_user_id' AS retained
      FROM community.friend_invitations AS invitation WHERE inviter_user_id = ANY($1::text[]) ORDER BY friend_invitation_id`, [users])).rows, invitationsBefore);
    for (const table of ["leaderboard_snapshot_entries", "streak_leaderboard_snapshot_entries"]) {
      assert.deepEqual((await client.query(`SELECT public_profile_id FROM community.${table} WHERE snapshot_id = $1`, [table === "leaderboard_snapshot_entries" ? ratingSnapshot : streakSnapshot])).rows, [{ public_profile_id: profiles[2] }]);
    }
    assert.equal((await client.query("SELECT leaderboard_participation_enabled FROM community.public_profiles WHERE user_id = $1", [target])).rows[0].leaderboard_participation_enabled, false);
    await client.query("SELECT set_config('app.user_id', $1, true)", [friend]);
    for (const id of [profiles[0], profiles[1], oldAlias]) {
      assert.equal((await client.query("SELECT * FROM community.read_leaderboard_profile_summary($1, 'qualified_reviews_v1', 'streak_days_v1', $2)", [id, generatedAt])).rowCount, 0);
    }
    await client.query("UPDATE community.public_profiles SET leaderboard_participation_enabled = TRUE WHERE user_id = $1", [target]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [target]);
    assert.equal((await client.query("SELECT * FROM community.read_leaderboard_profile_summary($1, 'qualified_reviews_v1', 'streak_days_v1', $2)", [oldAlias, generatedAt])).rows[0].public_profile_id, profiles[1]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [joiner]);
    assert.equal((await client.query("SELECT * FROM community.accept_friend_invitation($1, 'My private label')", [tokenHash(pendingInvite)])).rows[0].inviter_public_profile_id, profiles[1]);
    await client.query(transfer, [target, later]);
    await client.query(retire, [target, later, randomUUID()]);
    assert.deepEqual((await client.query("SELECT DISTINCT canonical_public_profile_id FROM community.public_profile_aliases WHERE alias_public_profile_id = ANY($1::uuid[])", [[oldAlias, profiles[0], profiles[1]]])).rows, [{ canonical_public_profile_id: profiles[4] }]);
    await client.query("DELETE FROM community.public_profiles WHERE user_id = $1", [later]);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community.public_profile_aliases WHERE alias_public_profile_id = ANY($1::uuid[])", [[oldAlias, profiles[0], profiles[1]]])).rows[0].count, 0);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});

test("community acceptance and ordinary scoped writers refuse contended retirement before graph locks", async () => {
  const owner = clientForOwner();
  const writer = clientForOwner();
  const users = Array.from({ length: 3 }, () => randomUUID());
  const [source, target, invitee] = users;
  const profiles = users.map(() => randomUUID());
  const invitation = randomUUID();
  const receipt = randomUUID();
  try {
    await Promise.all([owner.connect(), writer.connect()]);
    for (const client of [owner, writer]) await client.query("SET statement_timeout = '3s'");
    for (const [index, userId] of users.entries()) await seedAccount(owner, userId, profiles[index]);
    await seedInvitation(owner, source, invitation);
    await writer.query("SET ROLE backend_app");
    await writer.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: source });
    await owner.query("BEGIN");
    await assert.rejects(owner.query(transfer, [source, target]), { code: "P0A01" });
    await owner.query("ROLLBACK");
    await writer.query("ROLLBACK");

    await owner.query("BEGIN");
    await owner.query("SELECT auth.lock_account_retirement($1, $2)", [source, target]);
    await writer.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: invitee });
    await assert.rejects(writer.query("SELECT * FROM community.accept_friend_invitation($1, 'Friend')", [tokenHash(invitation)]), { code: "P0A01" });
    await writer.query("ROLLBACK");
    await owner.query("ROLLBACK");

    await owner.query("BEGIN");
    await owner.query("SELECT auth.lock_account_lifecycle($1)", [source]);
    await writer.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: invitee });
    await assert.rejects(writer.query("SELECT * FROM community.accept_friend_invitation($1, 'Friend')", [tokenHash(invitation)]), { code: "P0A01" });
    await writer.query("ROLLBACK");
    await owner.query("ROLLBACK");

    await writer.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: invitee });
    await assert.rejects(writer.query("SELECT * FROM community.accept_friend_invitation($1, 'Friend')", [tokenHash(invitation)]), { code: "P0A01" });
    await writer.query("ROLLBACK");

    await writer.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await writer.query("SELECT user_id FROM org.user_settings WHERE user_id = $1", [source]);
    await owner.query("BEGIN");
    await owner.query(transfer, [source, target]);
    await owner.query(retire, [source, target, receipt]);
    await owner.query("COMMIT");
    await assert.rejects(applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: source }), { code: "P0A01" });
    await writer.query("ROLLBACK");
    await writer.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: invitee });
    const accepted = (await writer.query("SELECT * FROM community.accept_friend_invitation($1, 'Friend')", [tokenHash(invitation)])).rows[0];
    assert.equal(accepted.acceptance_status, "accepted");
    assert.equal(accepted.inviter_public_profile_id, profiles[1]);
    await writer.query("COMMIT");
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM community.friendships WHERE viewer_user_id = $1 OR friend_user_id = $1", [source])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM community.friendships WHERE viewer_user_id = $1 OR friend_user_id = $1", [target])).rows[0].count, 2);
  } finally {
    try {
      await Promise.all([owner.query("ROLLBACK"), writer.query("ROLLBACK")]);
      await owner.query("DELETE FROM community.friendships WHERE viewer_user_id = ANY($1::text[]) OR friend_user_id = ANY($1::text[])", [users]);
      await owner.query("DELETE FROM community.friend_invitations WHERE friend_invitation_id = $1", [invitation]);
      await owner.query("DELETE FROM auth.account_retirements WHERE retirement_id = $1", [receipt]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [users]);
    } finally { await Promise.all([owner.end(), writer.end()]); }
  }
});

test("community transfer reparents a lone profile and leaves profileless accounts lazy", async () => {
  const client = clientForOwner();
  const [source, target, otherSource, otherTarget] = Array.from({ length: 4 }, () => randomUUID());
  const profile = randomUUID();
  const alias = randomUUID();
  try {
    await client.connect();
    await client.query("BEGIN");
    await seedAccount(client, source, profile);
    for (const userId of [target, otherSource, otherTarget]) await seedAccount(client, userId, null);
    await client.query("UPDATE community.public_profiles SET leaderboard_participation_enabled = FALSE WHERE user_id = $1", [source]);
    await client.query("INSERT INTO community.public_profile_aliases VALUES ($1, $2)", [alias, profile]);
    await client.query(transfer, [source, target]);
    await client.query(retire, [source, target, randomUUID()]);
    assert.deepEqual((await client.query("SELECT user_id, public_profile_id, leaderboard_participation_enabled FROM community.public_profiles WHERE user_id IN ($1, $2)", [source, target])).rows,
      [{ user_id: target, public_profile_id: profile, leaderboard_participation_enabled: false }]);
    assert.equal((await client.query("SELECT canonical_public_profile_id FROM community.public_profile_aliases WHERE alias_public_profile_id = $1", [alias])).rows[0].canonical_public_profile_id, profile);
    await client.query(transfer, [otherSource, otherTarget]);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community.public_profiles WHERE user_id IN ($1, $2)", [otherSource, otherTarget])).rows[0].count, 0);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
