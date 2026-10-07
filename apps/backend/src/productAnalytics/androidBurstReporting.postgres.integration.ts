import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import {
  buildExcludedActorSqlLines,
  buildReviewAnswersCteSql,
  probableAndroidBurstActorIdsSql,
} from "../reviewMetricsSql";

type ActorFixture = Readonly<{
  actorId: string;
  rawUserId: string;
  subjectId: string;
  deviceModel: string;
}>;
type ActorRow = Readonly<{ actor_id: string }>;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for Android burst reporting integration.");
  }
  return databaseUrl;
}

async function insertActivity(
  client: pg.PoolClient,
  actor: ActorFixture,
  occurredAt: string,
  platform: string,
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.product_events (
       event_id, schema_version, event_name, origin, server_received_at, occurred_at,
       user_id, subject_user_id, trust_level, platform, device_model, os_version,
       app_version, event_properties
     )
     SELECT event_id, 1, event_name, 'server', $1::timestamptz, $1::timestamptz,
       $2::uuid, $3::uuid, 'server_derived', $4::text, $5::text, 'Android 11', '1.32.0', '{}'
     FROM unnest($6::uuid[], ARRAY['app_opened', 'review_answered']) AS events(event_id, event_name)`,
    [occurredAt, actor.rawUserId, actor.subjectId, platform, actor.deviceModel, [randomUUID(), randomUUID()]],
  );
}

async function insertExclusion(
  client: pg.PoolClient,
  actorId: string,
  source: string,
  excludedBy: string,
  reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.excluded_actors (actor_id, source, excluded_by, reason)
     VALUES ($1, $2, $3, $4)`,
    [actorId, source, excludedBy, reason],
  );
}

async function readKeptActors(client: pg.PoolClient, actorIds: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
  const result = await client.query<ActorRow>(
    `SELECT DISTINCT resolved.actor_id::text AS actor_id
     FROM analytics.product_events_resolved AS resolved
     WHERE resolved.event_name = 'app_opened'
       AND resolved.actor_id = ANY($1::uuid[])
       AND resolved.occurred_at >= '2020-01-01'::timestamptz
       AND resolved.occurred_at < '2020-01-02'::timestamptz
       AND resolved.platform = 'android'
       ${buildExcludedActorSqlLines("resolved.actor_id::text").join("\n")}
     ORDER BY actor_id`,
    [actorIds],
  );
  return result.rows.map((row) => row.actor_id);
}

test("historical Android bursts re-enter reports on later evidence and respect person-level restores", async () => {
  const pool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const client = await pool.connect();
  const burstModel = `burst-${randomUUID()}`;
  const actors = Array.from({ length: 13 }, (_, index): ActorFixture => {
    const actorId = randomUUID();
    return {
      actorId,
      rawUserId: index === 1 || index === 3 ? randomUUID() : actorId,
      subjectId: randomUUID(),
      deviceModel: index < 8 ? burstModel : `ordinary-${randomUUID()}`,
    };
  });
  const actorIds = actors.map((actor) => actor.actorId);
  const recentModel = `recent-${randomUUID()}`;
  const recentActors = Array.from({ length: 4 }, (): ActorFixture => {
    const actorId = randomUUID();
    return { actorId, rawUserId: actorId, subjectId: actorId, deviceModel: recentModel };
  });
  const legacyReason = "android install burst: 4+ short-lived guest installs of one device fingerprint within 24h";
  const detector = "job:synthetic-actor-detector";
  const actorAt = (index: number): ActorFixture => {
    const actor = actors[index];
    assert.ok(actor !== undefined);
    return actor;
  };

  try {
    await client.query("BEGIN");
    for (const actor of actors) {
      await client.query(
        `INSERT INTO analytics.identity_links (link_id, anonymous_id, user_id, source)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'server_derived')`,
        [randomUUID(), actor.subjectId, actor.actorId],
      );
      await insertActivity(client, actor, "2020-01-01T10:00:00Z", "android");
    }
    const now = new Date().toISOString();
    for (const actor of recentActors) {
      await insertActivity(client, actor, now, "android");
    }
    for (const index of [0, 1, 2]) {
      await insertExclusion(client, actorAt(index).actorId, "automatic", detector, legacyReason);
    }
    await insertExclusion(client, actorAt(3).rawUserId, "manual", "integration", "restore raw ID");
    await insertExclusion(client, actorAt(4).subjectId, "manual", "integration", "restore subject ID");
    await insertExclusion(client, actorAt(5).actorId, "manual", detector, legacyReason);
    await insertExclusion(client, actorAt(9).actorId, "manual", "integration", "manual exclusion");
    await insertExclusion(client, actorAt(10).actorId, "automatic", detector,
      "no client_installation replica and no app_opened event");
    await insertExclusion(client, actorAt(11).actorId, "manual", "integration", "restored ordinary guest");
    await insertExclusion(client, actorAt(12).actorId, "automatic", "other-job", legacyReason);
    await client.query(
      `UPDATE analytics.excluded_actors SET restored_at = now(), restored_by = 'integration'
       WHERE actor_id = ANY($1::text[])`,
      [[actorAt(2).actorId, actorAt(3).rawUserId, actorAt(4).subjectId, actorAt(11).actorId]],
    );

    await client.query("SET LOCAL ROLE reporting_readonly");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const candidates = await client.query<ActorRow>(probableAndroidBurstActorIdsSql);
    assert.deepEqual(
      candidates.rows.filter((row) => actorIds.includes(row.actor_id)).map((row) => row.actor_id).sort(),
      [0, 1, 5, 6, 7].map((index) => actorAt(index).actorId).sort(),
    );
    assert.ok(candidates.rows.every((row) => row.actor_id !== null));
    assert.ok(recentActors.every((actor) => candidates.rows.some((row) => row.actor_id === actor.actorId)));
    assert.deepEqual(await readKeptActors(client, actorIds), [2, 3, 4, 8, 11].map((index) => actorAt(index).actorId).sort());
    await client.query("RESET ROLE");

    // A return outside the report's selected dates/platform must restore earlier Android activity.
    await insertActivity(client, actorAt(0), "2020-01-02T10:00:00Z", "ios");
    await insertActivity(client, actorAt(5), "2020-01-02T10:00:00Z", "web");
    await client.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [actorAt(1).rawUserId.toUpperCase()]);
    await client.query(
      `INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)
       VALUES ('cognito', $1, $2)`,
      [randomUUID(), actorAt(1).rawUserId.toUpperCase()],
    );
    await client.query("SET LOCAL ROLE reporting_readonly");
    const expectedKept = [0, 1, 2, 3, 4, 8, 11].map((index) => actorAt(index).actorId).sort();
    assert.deepEqual(await readKeptActors(client, actorIds), expectedKept);
    const reviews = await client.query<ActorRow>(
      `WITH ${buildReviewAnswersCteSql("'2020-01-02'::timestamptz", "resolved.actor_id = ANY($1::uuid[])")}
       SELECT DISTINCT actor_id FROM review_answers ORDER BY actor_id`,
      [actorIds],
    );
    assert.deepEqual(reviews.rows.map((row) => row.actor_id), expectedKept);
    const audit = await client.query<Readonly<{ actor_id: string }>>(
      "SELECT actor_id FROM analytics.excluded_actors WHERE actor_id = ANY($1::text[]) AND restored_at IS NULL",
      [[actorAt(0).actorId, actorAt(1).actorId]],
    );
    assert.equal(audit.rowCount, 2);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
