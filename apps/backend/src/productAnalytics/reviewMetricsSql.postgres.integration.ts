import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import {
  buildDailyReviewActorPlatformSql,
  buildExcludedActorSqlLines,
  buildReviewAnswersCteSql,
} from "../reviewMetricsSql";

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for review metrics SQL integration.");
  }
  return databaseUrl;
}

async function insertReview(
  client: pg.PoolClient,
  actorId: string,
  occurredAt: string,
  platform: string,
  deviceModel: string,
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.product_events (
       event_id, schema_version, event_name, origin, server_received_at, occurred_at,
       user_id, subject_user_id, trust_level, platform, device_model, os_version, app_version, event_properties
     ) VALUES ($1, 1, 'review_answered', 'server', $2, $2,
       $3, $3, 'server_derived', $4, $5, 'Android 11', '1.40.0', '{}')`,
    [randomUUID(), occurredAt, actorId, platform, deviceModel],
  );
}

test("shared actor exclusions preserve identities, NULL actors and all-history review cohorts", { timeout: 30_000 }, async () => {
  const pool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const client = await pool.connect();
  const actors = {
    ordinary: randomUUID(), returning: randomUUID(), testEmail: randomUUID(), plusTest: randomUUID(),
    admin: randomUUID(), listed: randomUUID(), restored: randomUUID(), legacyAudit: randomUUID(),
    legacyManual: randomUUID(), legacyOtherJob: randomUUID(), automated: randomUUID(),
    automationGuest: randomUUID(), automationAccount: randomUUID(), testOwner: randomUUID(),
    testPreviousOwner: randomUUID(), sandbox: randomUUID(), scraper: randomUUID(),
  };
  const burstActors = Array.from({ length: 4 }, () => randomUUID());
  const candidateIds = [...Object.values(actors), ...burstActors];
  const guestId = randomUUID();
  const legacyReason = "android install burst: 4+ short-lived guest installs of one device fingerprint within 24h";
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    for (const actorId of Object.values(actors)) {
      await insertReview(client, actorId, "2020-01-02T10:00:00Z", "web", actorId);
    }
    const burstModel = `burst-${randomUUID()}`;
    for (const actorId of burstActors) {
      await insertReview(client, actorId, "2020-01-02T10:00:00Z", "android", burstModel);
    }
    await client.query(
      `INSERT INTO analytics.identity_links (link_id, anonymous_id, user_id, source)
       VALUES ($1, $2, $3, 'server_derived')`,
      [randomUUID(), guestId, actors.returning],
    );
    await insertReview(client, guestId, "2019-12-31T10:00:00Z", "ios", guestId);
    await client.query(
      `INSERT INTO org.user_settings (user_id, email) VALUES
       ($1, ' Person@EXAMPLE.COM '), ($2, 'person+TEST@real.test'),
       ($3, ' Admin@real.test '), ($4, 'person@real.test'), ($5, 'test-build@real.test')`,
      [actors.testEmail.toUpperCase(), actors.plusTest, actors.admin.toUpperCase(),
        actors.automationAccount.toUpperCase(), actors.testOwner.toUpperCase()],
    );
    await client.query(
      `INSERT INTO auth.admin_users (email, granted_by, source, revoked_at)
       VALUES ('admin@real.test', 'integration', 'manual', now())`,
    );
    await client.query(
      `INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)
       VALUES ('cognito', $1, $2), ('cognito', $3, $4)`,
      [randomUUID(), actors.automationAccount.toUpperCase(), randomUUID(), actors.testOwner.toUpperCase()],
    );
    await client.query(
      `INSERT INTO analytics.excluded_actors (actor_id, source, excluded_by, reason, restored_at, restored_by)
       VALUES ($1, 'manual', 'integration', 'listed', NULL, NULL),
       ($2, 'manual', 'integration', 'restored', now(), 'integration'),
       ($3, 'automatic', 'job:synthetic-actor-detector', $6, NULL, NULL),
       ($4, 'manual', 'job:synthetic-actor-detector', $6, NULL, NULL),
       ($5, 'automatic', 'other-job', $6, NULL, NULL)`,
      [actors.listed, actors.restored, actors.legacyAudit, actors.legacyManual, actors.legacyOtherJob, legacyReason],
    );
    await client.query(
      `INSERT INTO analytics.product_events (
         event_id, schema_version, event_name, origin, server_received_at, occurred_at,
         user_id, anonymous_id, trust_level, platform, automated_client, event_properties
       ) VALUES ($1, 1, 'app_opened', 'client', now(), now(), $2, NULL, 'guest_client', 'web', true, '{}'),
       ($3, 1, 'app_opened', 'client', now(), now(), NULL, NULL, 'anonymous_client', 'web', true, '{}'),
       ($4, 1, 'entitlement_changed', 'server', now(), now(), $5, NULL, 'server_derived', 'ios', NULL,
         '{"environment":"sandbox"}'),
       ($6, 1, 'site_page_viewed', 'client', now(), now(), NULL, $7, 'anonymous_client', 'web', NULL,
         '{"automation":"webdriver"}')`,
      [randomUUID(), actors.automated, randomUUID(), randomUUID(), actors.sandbox, randomUUID(), actors.scraper],
    );
    const testInstallation = randomUUID();
    await client.query(
      `INSERT INTO sync.installations (installation_id, user_id, platform, is_automation, is_test_distribution)
       VALUES ($1, $2, 'web', true, false), ($3, $4, 'web', true, false), ($5, $6, 'ios', false, true)`,
      [randomUUID(), actors.automationGuest.toUpperCase(), randomUUID(), actors.automationAccount.toUpperCase(),
        testInstallation, actors.testOwner.toUpperCase()],
    );
    const workspaceId = randomUUID();
    await client.query(
      `INSERT INTO org.workspaces (workspace_id, name, fsrs_client_updated_at,
         fsrs_last_modified_by_replica_id, fsrs_last_operation_id)
       VALUES ($1, 'Review metrics integration', now(), $2, $3)`,
      [workspaceId, randomUUID(), randomUUID()],
    );
    await client.query(
      `INSERT INTO sync.workspace_replicas (replica_id, workspace_id, user_id, actor_kind, installation_id, platform)
       VALUES ($1, $2, $3, 'client_installation', $4, 'ios')`,
      [randomUUID(), workspaceId, actors.testPreviousOwner.toUpperCase(), testInstallation],
    );
    await client.query("REFRESH MATERIALIZED VIEW analytics.probable_android_burst_actors");
    await client.query("REFRESH MATERIALIZED VIEW analytics.probable_scraper_fleet_visitors");
    await client.query("SET LOCAL ROLE reporting_readonly");
    const expected = [actors.ordinary, actors.returning, actors.restored, actors.legacyAudit, actors.automationAccount].sort();
    const kept = await client.query<Readonly<{ actor_id: string | null }>>(
      `SELECT actor_id FROM unnest($1::text[] || ARRAY[NULL::text]) AS candidates(actor_id)
       WHERE true ${buildExcludedActorSqlLines("actor_id").join("\n")}
       ORDER BY actor_id NULLS LAST`,
      [candidateIds],
    );
    assert.deepEqual(kept.rows.map((row) => row.actor_id), [...expected, null]);
    const reviews = await client.query<Readonly<{
      actor_id: string; platform: string; first_review_date: string; review_event_count: number;
    }>>(
      `WITH ${buildReviewAnswersCteSql("'2020-01-03'::timestamptz", "resolved.actor_id = ANY($1::uuid[])")}
       SELECT actor_id, platform, first_review_date::text, review_event_count FROM (
         ${buildDailyReviewActorPlatformSql("review_answers.review_date = '2020-01-02' AND review_answers.platform = 'web'")}
       ) AS daily ORDER BY actor_id`,
      [candidateIds],
    );
    assert.deepEqual(reviews.rows, expected.map((actorId) => ({
      actor_id: actorId, platform: "web", first_review_date: actorId === actors.returning ? "2019-12-31" : "2020-01-02",
      review_event_count: 1,
    })));
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
