import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../database";
import { resolveAiUsageOwnerInExecutor } from "../aiUsage/identity";
import { authenticateGuestSession } from "../guestAuth/session";
import { completeGuestUpgradeInExecutor, prepareGuestUpgradeInExecutor } from "../guestAuth/upgrade";
import { loadGuestUpgradeReplayInExecutor } from "../guestAuth/store/upgradeHistory";
import { loadRequestContext, getClientAccountIdentity } from "../server/requestContext";
import { deleteRealAccountDataInExecutor } from "./accountDeletion";
import { resetAuthConfigForTests } from "./config";
import { loadCognitoIdentityMappingInExecutor } from "./userIdentities";
import { recordAiConsent } from "../aiConsent";
import { currentAiDisclosureVersion, type AiConsentInput } from "../aiConsent/input";
import { updateGuestSessionAnalyticsPreferences } from "../guestAuth/store/session";
import { productAnalyticsSchemaVersion } from "../productAnalytics/catalog";
import { insertProductAnalyticsClientBatch } from "../productAnalytics/writer";
import type { ClientProductAnalyticsEventRow, ProductAnalyticsInstallationObservation } from "../productAnalytics/types";

type Preview = Readonly<{
  sourceUserId: string;
  targetUserId: string;
  rowLimit: number;
  workspaceLimit: number;
  ownerRows: number;
  fingerprint: string;
  workspaceIds: Array<string>;
  selectedWorkspaceId: string;
  suppressedWorkspaceIds: Array<string>;
}>;
type Result = Readonly<{
  operationId: string;
  sourceUserId: string;
  canonicalAccountId: string;
  workspaceIds: Array<string>;
  selectedWorkspaceId: string;
  suppressedWorkspaceIds: Array<string>;
}>;
type Fixture = Readonly<{
  source: string; target: string; friend: string; subjects: Array<string>;
  workspaceIds: Array<string>; replica: string; installation: string; card: string;
  session: string; file: string; prompt: string; feedback: string; consent: string;
  key: string; oauth: string; client: string; purchase: string; usage: Array<string>;
  guestSession: string; guestToken: string; operation: string; provider: string;
}>;

const previewSql = "SELECT auth.preview_account_union($1,$2,$3,$4) AS preview";
const combineSql = "SELECT auth.combine_proved_accounts($1,$2,$3,$4::jsonb) AS result";
const capabilities = {
  guestWorkspaceSyncedAndOutboxDrained: true,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: true,
} as const;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

function connection(): pg.Client {
  const url = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (url === undefined || url === "") throw new Error("TEST_DATABASE_ADMIN_URL is required");
  return new pg.Client({ connectionString: url });
}

function executor(client: pg.Client): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

async function preview(client: pg.Client, fixture: Fixture): Promise<Preview> {
  const result = await client.query<Readonly<{ preview: Preview }>>(previewSql,
    [fixture.source, fixture.target, 10000, 32]);
  return result.rows[0].preview;
}

async function combine(client: pg.Client, fixture: Fixture, authorized: Preview): Promise<Result> {
  const result = await client.query<Readonly<{ result: Result }>>(combineSql,
    [fixture.operation, fixture.source, fixture.target, JSON.stringify(authorized)]);
  return result.rows[0].result;
}

async function seed(client: pg.Client): Promise<Fixture> {
  await client.query("BEGIN");
  const source = randomUUID();
  const target = randomUUID();
  const friend = randomUUID();
  const fixture: Fixture = {
    source, target, friend, subjects: [randomUUID(), randomUUID()],
    workspaceIds: [randomUUID(), randomUUID(), randomUUID()],
    replica: randomUUID(), installation: randomUUID(), card: randomUUID(),
    session: randomUUID(), file: randomUUID(), prompt: randomUUID(), feedback: randomUUID(),
    consent: randomUUID(), key: randomUUID(), oauth: randomUUID(), client: randomUUID(),
    purchase: randomUUID(), usage: [randomUUID(), randomUUID()],
    guestSession: randomUUID(), guestToken: randomUUID(), operation: randomUUID(), provider: randomUUID(),
  };
  for (const user of [source, target, friend]) {
    await client.query("INSERT INTO org.user_settings(user_id, progress_time_zone) VALUES ($1,'UTC')", [user]);
  }
  for (const [index, user] of [source, target].entries()) {
    await client.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())",
      [fixture.subjects[index], "fixture-" + fixture.subjects[index] + "@mail.test"]);
    await client.query("SELECT auth.bind_cognito_account($1,$2)", [fixture.subjects[index], user]);
  }
  await client.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)",
    [fixture.provider, fixture.subjects[0], "fixture-" + fixture.subjects[0] + "@mail.test"]);
  for (const [index, id] of fixture.workspaceIds.entries()) {
    await client.query(`INSERT INTO org.workspaces(workspace_id,name,creation_origin,fsrs_client_updated_at,
      fsrs_last_modified_by_replica_id,fsrs_last_operation_id) VALUES ($1,$2,$3,now(),$4,'seed')`,
    [id, index === 0 ? "Personal" : "Meaningful", index === 0 ? "automatic_starter" : "explicit", fixture.replica]);
  }
  await client.query(`INSERT INTO org.workspace_memberships(workspace_id,user_id,role)
    VALUES ($1,$4,'owner'),($2,$5,'owner'),($3,$4,'owner'),($3,$5,'member'),($3,$6,'owner')`,
  [...fixture.workspaceIds, source, target, friend]);
  await client.query("UPDATE org.user_settings SET workspace_id=$2,locale='en',analytics_consent='declined',product_analytics_enabled=false WHERE user_id=$1",
    [source, fixture.workspaceIds[0]]);
  await client.query("UPDATE org.user_settings SET workspace_id=$2,locale='es' WHERE user_id=$1", [target, fixture.workspaceIds[1]]);
  await client.query("INSERT INTO sync.installations(installation_id,user_id,platform) VALUES ($1,$2,'ios')", [fixture.installation, source]);
  await client.query(`INSERT INTO sync.workspace_replicas(replica_id,workspace_id,user_id,actor_kind,installation_id,platform)
    VALUES ($1,$2,$3,'client_installation',$4,'ios')`, [fixture.replica, fixture.workspaceIds[2], source, fixture.installation]);
  await client.query(`INSERT INTO content.cards(card_id,workspace_id,front_text,back_text,metadata,
    created_at,client_updated_at,last_modified_by_replica_id,last_operation_id)
    VALUES ($1,$2,'Question','Answer','{"version":1,"source":null}',now(),now(),$3,'immutable-operation')`,
  [fixture.card, fixture.workspaceIds[2], fixture.replica]);
  await client.query("INSERT INTO ai.chat_sessions(session_id,user_id,workspace_id,status) VALUES ($1,$2,$3,'idle')",
    [fixture.session, source, fixture.workspaceIds[2]]);
  await client.query(`INSERT INTO ai.chat_files(file_id,session_id,user_id,workspace_id,path,origin,media_type,size_bytes,sha256,s3_key)
    VALUES ($1::uuid,$2,$3,$4,'/files/kept.txt','attachment','text/plain',4,$5,$1::text)`,
  [fixture.file, fixture.session, source, fixture.workspaceIds[2], hash("kept")]);
  await client.query(`INSERT INTO support.feedback_prompt_events(feedback_prompt_event_id,user_id,workspace_id,
    installation_id,platform,event_type,created_at_client) VALUES ($1,$2,$3,$4,'ios','automatic_prompt_shown',now())`,
  [fixture.prompt, source, fixture.workspaceIds[2], fixture.installation]);
  await client.query(`INSERT INTO support.feedback_submissions(feedback_submission_id,user_id,workspace_id,
    installation_id,platform,trigger,message,created_at_client) VALUES ($1,$2,$3,$4,'ios','settings','Preserve feedback',now())`,
  [fixture.feedback, source, fixture.workspaceIds[2], fixture.installation]);
  await client.query("INSERT INTO ai.consent_identities(actor_user_id,user_id) VALUES ($1,$1)", [source]);
  await client.query(`INSERT INTO ai.consent_events(event_id,actor_user_id,installation_id,action,decision_sequence,
    disclosure_version,locale,disclosure_text,provider,purposes,app_version,app_build,platform,occurred_at)
    VALUES ($1,$2,$3,'withdraw',1,'1','en','Fixture disclosure','openai',
      ARRAY['chat','transcription','image_generation'],'1','1','ios',now())`,
  [fixture.consent, source, fixture.installation]);
  await client.query("INSERT INTO auth.agent_api_keys(connection_id,user_id,label,key_id,key_hash,selected_workspace_id) VALUES ($1,$2,'kept',$3,$4,$5)",
    [fixture.key, source, randomUUID(), hash(fixture.key), fixture.workspaceIds[2]]);
  await client.query("INSERT INTO auth.oauth_clients(client_id,redirect_uris,token_endpoint_auth_method) VALUES ($1,ARRAY['https://client.test/callback'],'none')", [fixture.client]);
  await client.query("INSERT INTO auth.oauth_connections(connection_id,user_id,client_id,label,selected_workspace_id) VALUES ($1,$2,$3,'kept',$4)",
    [fixture.oauth, source, fixture.client, fixture.workspaceIds[2]]);
  await client.query(`INSERT INTO auth.oauth_access_tokens(token_hash,connection_id,scope,resource,expires_at)
    VALUES ($1,$2,'openid flashcards','https://mcp.nibomo.com',now()+interval '1 hour')`, [hash(fixture.oauth), fixture.oauth]);
  await client.query(`INSERT INTO billing.purchases(purchase_id,provider,provider_purchase_id,kind,user_id,previous_user_id,tier,status,environment)
    VALUES ($1::uuid,'apple',$1::text,'one_time',$2,$3,'lifetime','active','sandbox')`, [fixture.purchase, source, friend]);
  await client.query("INSERT INTO billing.user_billing_state(user_id,trial_consumed_at,trial_provider) VALUES ($1,'2025-01-01','apple'),($2,'2026-01-01','google')", [source, target]);
  for (const [index, id] of fixture.usage.entries()) {
    await client.query(`INSERT INTO ai.usage_events(usage_event_id,user_id,workspace_id,occurred_at,surface,provider,model_id,
      request_id,tier_at_call,input_tokens,user_supplied_key) VALUES ($1::uuid,$2,$3,$4,'chat','openai','fixture',$1::text,'free',11,$5)`,
    [id, source, fixture.workspaceIds[2], index === 0 ? "2025-01-01" : "2026-10-01", index === 1]);
  }
  await client.query("INSERT INTO auth.guest_sessions(session_id,session_secret_hash,user_id,platform) VALUES ($1,$2,$3,'ios')",
    [fixture.guestSession, hash(fixture.guestToken), source]);
  await client.query("COMMIT");
  return fixture;
}

async function remove(client: pg.Client, fixture: Fixture): Promise<void> {
  const users = [fixture.source, fixture.target, fixture.friend];
  await client.query("ROLLBACK");
  await client.query("DELETE FROM auth.account_union_receipts WHERE source_user_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])", [users]);
  await client.query("DELETE FROM auth.account_retirements WHERE retired_user_id=ANY($1::text[]) OR canonical_user_id=ANY($1::text[])", [users]);
  await client.query("DELETE FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [fixture.workspaceIds]);
  await client.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [users]);
  await client.query("DELETE FROM sync.installations WHERE installation_id=$1", [fixture.installation]);
  await client.query("DELETE FROM auth.cognito_principals WHERE cognito_subject=ANY($1::text[])", [fixture.subjects]);
  await client.query("DELETE FROM auth.oauth_clients WHERE client_id=$1", [fixture.client]);
  await client.query("DELETE FROM billing.purchases WHERE purchase_id=$1", [fixture.purchase]);
  await client.query("DELETE FROM billing.history_subjects WHERE subject_hash=$1", [hash(fixture.purchase)]);
  await client.query("DELETE FROM billing.user_billing_state WHERE user_id=ANY($1::text[])", [users]);
  await client.query("DELETE FROM ai.usage_events WHERE usage_event_id=ANY($1::uuid[])", [fixture.usage]);
  await client.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256=ANY($1::text[])", [users.map(hash)]);
}

async function retainedRows(client: pg.Client, fixture: Fixture): Promise<Array<Readonly<{ category: string; retained: string }>>> {
  const result = await client.query<Readonly<{ category: string; retained: string }>>(`
    SELECT 'card' AS category,to_jsonb(r)::text AS retained FROM content.cards r WHERE card_id=$1
    UNION ALL SELECT 'replica',(to_jsonb(r)-'user_id')::text FROM sync.workspace_replicas r WHERE replica_id=$2
    UNION ALL SELECT 'installation',(to_jsonb(r)-'user_id')::text FROM sync.installations r WHERE installation_id=$3
    UNION ALL SELECT 'chat',(to_jsonb(r)-'user_id')::text FROM ai.chat_sessions r WHERE session_id=$4
    UNION ALL SELECT 'file',(to_jsonb(r)-'user_id')::text FROM ai.chat_files r WHERE file_id=$5
    UNION ALL SELECT 'prompt',(to_jsonb(r)-'user_id')::text FROM support.feedback_prompt_events r WHERE feedback_prompt_event_id=$6
    UNION ALL SELECT 'feedback',(to_jsonb(r)-'user_id')::text FROM support.feedback_submissions r WHERE feedback_submission_id=$7
    UNION ALL SELECT 'consent',to_jsonb(r)::text FROM ai.consent_events r WHERE event_id=$8
    UNION ALL SELECT 'key',(to_jsonb(r)-'user_id')::text FROM auth.agent_api_keys r WHERE connection_id=$9
    UNION ALL SELECT 'oauth',(to_jsonb(r)-'user_id')::text FROM auth.oauth_connections r WHERE connection_id=$10
    UNION ALL SELECT 'token',to_jsonb(r)::text FROM auth.oauth_access_tokens r WHERE connection_id=$10
    UNION ALL SELECT 'guest',to_jsonb(r)::text FROM auth.guest_sessions r WHERE session_id=$11
    UNION ALL SELECT 'purchase',(to_jsonb(r)-'user_id')::text FROM billing.purchases r WHERE purchase_id=$12
    UNION ALL SELECT 'usage',(to_jsonb(r)-'user_id')::text FROM ai.usage_events r WHERE usage_event_id=ANY($13::uuid[])
    ORDER BY category,retained`, [fixture.card, fixture.replica, fixture.installation, fixture.session, fixture.file,
    fixture.prompt, fixture.feedback, fixture.consent, fixture.key, fixture.oauth, fixture.guestSession, fixture.purchase, fixture.usage]);
  return result.rows;
}

test("private account union preserves immutable data, original credentials, restrictive settings and exact receipts", async () => {
  const owner = connection();
  const runtime = connection();
  let fixture: Fixture | undefined;
  try {
    await Promise.all([owner.connect(), runtime.connect()]);
    await owner.query("SET statement_timeout='10s'");
    fixture = await seed(owner);
    const authorized = await preview(owner, fixture);
    assert.deepEqual(await preview(owner, fixture), authorized);
    assert.equal(authorized.selectedWorkspaceId, fixture.workspaceIds[1]);
    assert.deepEqual(authorized.suppressedWorkspaceIds, [fixture.workspaceIds[0]]);
    const before = await retainedRows(owner, fixture);
    const sourceSettings = (await owner.query("SELECT to_jsonb(r) AS settings FROM org.user_settings r WHERE user_id=$1", [fixture.source])).rows[0];
    for (const role of ["backend_app", "auth_app", "reporting_readonly"]) {
      await runtime.query("SET ROLE " + role);
      await assert.rejects(runtime.query(previewSql, [fixture.source, fixture.target, 10000, 32]), { code: "42501" });
      await assert.rejects(combine(runtime, fixture, authorized), { code: "42501" });
      await assert.rejects(runtime.query("SELECT * FROM auth.account_union_receipts"), { code: "42501" });
      await runtime.query("RESET ROLE");
    }
    await owner.query("BEGIN");
    const result = await combine(owner, fixture, authorized);
    assert.deepEqual(result.workspaceIds, [...fixture.workspaceIds].sort());
    assert.equal(result.canonicalAccountId, fixture.target);
    assert.deepEqual(await retainedRows(owner, fixture), before);
    assert.deepEqual((await owner.query("SELECT to_jsonb(r) AS settings FROM org.user_settings r WHERE user_id=$1", [fixture.source])).rows[0], sourceSettings);
    assert.deepEqual((await owner.query("SELECT locale,analytics_consent,product_analytics_enabled,workspace_id FROM org.user_settings WHERE user_id=$1", [fixture.target])).rows[0],
      { locale: "es", analytics_consent: "declined", product_analytics_enabled: false, workspace_id: fixture.workspaceIds[1] });
    assert.deepEqual((await owner.query("SELECT user_id,role FROM org.workspace_memberships WHERE workspace_id=$1 ORDER BY user_id", [fixture.workspaceIds[2]])).rows,
      [fixture.target, fixture.friend].sort().map((id) => ({ user_id: id, role: "owner" })));
    for (const table of ["auth.user_identities", "auth.agent_api_keys", "auth.oauth_connections", "sync.installations",
      "sync.workspace_replicas", "ai.chat_sessions", "ai.chat_files", "support.feedback_prompt_events", "support.feedback_submissions", "ai.consent_identities"]) {
      assert.equal((await owner.query("SELECT count(*)::int AS count FROM " + table + " WHERE user_id=$1", [fixture.source])).rows[0].count, 0, table);
    }
    assert.equal((await loadCognitoIdentityMappingInExecutor(executor(owner), fixture.subjects[0]))?.originalClientUserId, fixture.source);
    assert.equal((await loadCognitoIdentityMappingInExecutor(executor(owner), fixture.subjects[0]))?.userId, fixture.target);
    assert.equal((await owner.query("SELECT min(trial_consumed_at)::text AS trial FROM billing.user_billing_state WHERE user_id=$1", [fixture.target])).rows[0].trial.slice(0, 10), "2025-01-01");
    assert.equal((await owner.query("SELECT starter_suppressed_at IS NOT NULL AS suppressed FROM org.workspaces WHERE workspace_id=$1", [fixture.workspaceIds[0]])).rows[0].suppressed, true);
    await owner.query("COMMIT");
    assert.deepEqual(await combine(owner, fixture, authorized), result);
    await assert.rejects(combine(owner, fixture, { ...authorized, fingerprint: hash("changed") }), { code: "23514" });
    await assert.rejects(owner.query(combineSql, [fixture.operation, fixture.target, fixture.source, JSON.stringify(authorized)]), { code: "23514" });
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.account_union_receipts WHERE operation_id=$1", [fixture.operation])).rows[0].count, 1);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.deleted_accounts WHERE user_id_sha256=ANY($1::text[])", [[fixture.source, fixture.target].map(hash)])).rows[0].count, 0);
    await runtime.query("SET ROLE backend_app");
    await runtime.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: fixture.target });
    assert.deepEqual((await runtime.query("SELECT workspace_id FROM org.visible_workspace_ids($1) ORDER BY workspace_id", [fixture.workspaceIds[1]])).rows.map((row) => row.workspace_id),
      fixture.workspaceIds.slice(1).sort());
    await runtime.query("ROLLBACK");
  } finally {
    await runtime.query("ROLLBACK");
    if (fixture !== undefined) await remove(owner, fixture);
    await Promise.all([owner.end(), runtime.end()]);
  }
});

test("bounded preview refuses changed inventory and transaction failure rolls back ownership, retirement and receipt", async () => {
  const owner = connection();
  let fixture: Fixture | undefined;
  try {
    await owner.connect();
    await owner.query("SET statement_timeout='10s'");
    fixture = await seed(owner);
    const authorized = await preview(owner, fixture);
    await assert.rejects(owner.query(previewSql, [fixture.source, fixture.target, 1, 32]), { code: "54000" });
    await assert.rejects(owner.query(previewSql, [fixture.source, fixture.target, 10000, 1]), { code: "54000" });
    await owner.query("UPDATE org.user_settings SET locale='de' WHERE user_id=$1", [fixture.source]);
    await assert.rejects(combine(owner, fixture, authorized), { code: "P0A01" });
    const changed = await preview(owner, fixture);
    const before = await retainedRows(owner, fixture);
    await owner.query("BEGIN");
    await combine(owner, fixture, changed);
    await assert.rejects(owner.query("SELECT 1/0"), { code: "22012" });
    await owner.query("ROLLBACK");
    assert.deepEqual(await retainedRows(owner, fixture), before);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.account_retirements WHERE retired_user_id=$1", [fixture.source])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.account_union_receipts WHERE operation_id=$1", [fixture.operation])).rows[0].count, 0);
    assert.deepEqual(await preview(owner, fixture), changed);
    await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await assert.rejects(combine(owner, fixture, changed), { code: "P0A01" });
    await owner.query("ROLLBACK");
    await owner.query("SET statement_timeout=0");
    await assert.rejects(combine(owner, fixture, changed), { code: "P0A01" });
  } finally {
    if (fixture !== undefined) await remove(owner, fixture);
    await owner.end();
  }
});

test("independent scoped sync, usage and deletion writers fence union and stale snapshots refuse after commit", async () => {
  const owner = connection();
  const runtime = connection();
  const contender = connection();
  let fixture: Fixture | undefined;
  try {
    await Promise.all([owner.connect(), runtime.connect(), contender.connect()]);
    for (const client of [owner, runtime, contender]) await client.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE backend_app");
    await contender.query("SET ROLE backend_app");
    fixture = await seed(owner);
    const authorized = await preview(owner, fixture);
    for (const write of [
      async (): Promise<void> => {
        await runtime.query("UPDATE sync.workspace_replicas SET last_seen_at=last_seen_at WHERE replica_id=$1", [fixture?.replica]);
      },
      async (): Promise<void> => {
        assert.equal(await resolveAiUsageOwnerInExecutor(executor(runtime), fixture!.source), fixture!.source);
      },
      async (): Promise<void> => {
        await runtime.query("SELECT auth.lock_account_lifecycle($1)", [fixture?.source]);
        await runtime.query("SELECT user_id FROM org.user_settings WHERE user_id=$1 FOR UPDATE", [fixture?.source]);
      },
    ]) {
      await runtime.query("BEGIN");
      await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: fixture.source });
      await write();
      await assert.rejects(combine(owner, fixture, authorized), { code: "P0A01" });
      await runtime.query("ROLLBACK");
    }
    await owner.query("BEGIN");
    await owner.query("SELECT auth.lock_account_retirement($1,$2)", [fixture.source, fixture.target]);
    for (const user of [fixture.source, fixture.target]) {
      await contender.query("BEGIN");
      await assert.rejects(applyUserDatabaseScopeInExecutor(executor(contender), { userId: user }), { code: "P0A01" });
      await contender.query("ROLLBACK");
    }
    await owner.query("ROLLBACK");
    await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await runtime.query("SELECT user_id FROM org.user_settings WHERE user_id=$1", [fixture.source]);
    await combine(owner, fixture, authorized);
    await assert.rejects(applyUserDatabaseScopeInExecutor(executor(runtime), { userId: fixture.source }), { code: "P0A01" });
    await runtime.query("ROLLBACK");
    await runtime.query("BEGIN");
    assert.equal(await resolveAiUsageOwnerInExecutor(executor(runtime), fixture.source), fixture.target);
    await runtime.query("COMMIT");
    await contender.query("BEGIN");
    await assert.rejects(applyUserDatabaseScopeInExecutor(executor(contender), { userId: fixture.source }), { code: "P0A01" });
    await contender.query("ROLLBACK");
  } finally {
    await Promise.all([runtime.query("ROLLBACK"), contender.query("ROLLBACK")]);
    if (fixture !== undefined) await remove(owner, fixture);
    await Promise.all([owner.end(), runtime.end(), contender.end()]);
  }
});

test("original provider proof captures the survivor while pre-union proof stays stale and sessions remain live", async () => {
  const owner = connection();
  const auth = connection();
  let fixture: Fixture | undefined;
  const attempts: Array<string> = [];
  const binding = hash(randomUUID());
  const makeProof = async (provider: string): Promise<string> => {
    const attempt = hash(randomUUID());
    attempts.push(attempt);
    await auth.query("SELECT auth.create_social_attempt($1,'google','ios','login',$2,NULL,NULL,NULL,NULL,'fixture',NULL,NULL,NULL,NULL)", [attempt, binding]);
    const claimed = await auth.query("SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')", [attempt, binding]);
    const claim = claimed.rows[0].claim_id as string;
    await auth.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [attempt, claim]);
    await auth.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)", [attempt, claim, provider]);
    return attempt;
  };
  try {
    await Promise.all([owner.connect(), auth.connect()]);
    await owner.query("SET statement_timeout='10s'");
    await auth.query("SET ROLE auth_app");
    fixture = await seed(owner);
    const old = await makeProof(fixture.provider);
    assert.equal((await owner.query("SELECT snapshot_account FROM auth.social_attempts WHERE attempt_sha256=$1", [old])).rows[0].snapshot_account, fixture.source);
    const credentials = (await owner.query("SELECT to_jsonb(r) AS retained FROM auth.provider_identities r WHERE provider_subject=$1", [fixture.provider])).rows;
    await combine(owner, fixture, await preview(owner, fixture));
    await assert.rejects(owner.query("SELECT auth.assert_social_attempt_live(r) FROM auth.social_attempts r WHERE attempt_sha256=$1", [old]), { code: "23514" });
    const fresh = await makeProof(fixture.provider);
    assert.equal((await owner.query("SELECT snapshot_account FROM auth.social_attempts WHERE attempt_sha256=$1", [fresh])).rows[0].snapshot_account, fixture.target);
    await owner.query("SELECT auth.assert_social_attempt_live(r) FROM auth.social_attempts r WHERE attempt_sha256=$1", [fresh]);
    assert.deepEqual((await owner.query("SELECT to_jsonb(r) AS retained FROM auth.provider_identities r WHERE provider_subject=$1", [fixture.provider])).rows, credentials);
    assert.equal((await owner.query("SELECT auth.principal_session_status($1,NULL) AS status", [fixture.subjects[0]])).rows[0].status, "valid");
    await assert.rejects(auth.query("SELECT auth.bind_cognito_account($1,$2)", [fixture.subjects[0], fixture.source]), { code: "P0A01" });
  } finally {
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256=ANY($1::text[])", [attempts]);
    if (fixture !== undefined) await remove(owner, fixture);
    await Promise.all([owner.end(), auth.end()]);
  }
});

test("retained guest credentials keep original projection and binding grace without enabling destructive upgrade", async () => {
  const previousAuthMode = process.env.AUTH_MODE;
  const owner = connection();
  const runtime = connection();
  let fixture: Fixture | undefined;
  const anonymousId = randomUUID();
  const eventIds = [randomUUID(), randomUUID()];
  try {
    process.env.AUTH_MODE = "cognito";
    resetAuthConfigForTests();
    await Promise.all([owner.connect(), runtime.connect()]);
    await owner.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE backend_app");
    fixture = await seed(owner);
    const input: AiConsentInput = {
      eventId: randomUUID(), installationId: fixture.installation, action: "withdraw",
      decisionSequence: 2, occurredAt: new Date().toISOString(),
      disclosureVersion: currentAiDisclosureVersion, locale: "en", disclosureText: "Fixture disclosure",
      appVersion: "1.35.0", appBuild: "135", platform: "ios",
    };
    const originalReceipt = await recordAiConsent(fixture.source, input, fixture.guestSession);
    await owner.query("UPDATE auth.user_identities SET created_at=now()-interval '8 days' WHERE provider_subject=$1", [fixture.subjects[0]]);
    await assert.rejects(authenticateGuestSession(fixture.guestToken), { code: "GUEST_AUTH_INVALID" });
    await combine(owner, fixture, await preview(owner, fixture));
    await assert.rejects(authenticateGuestSession(fixture.guestToken), { code: "GUEST_AUTH_INVALID" });
    await owner.query("UPDATE auth.user_identities SET created_at=now()-interval '1 day' WHERE provider_subject=$1", [fixture.subjects[0]]);
    const guest = await authenticateGuestSession(fixture.guestToken);
    assert.equal(guest.userId, fixture.source);
    const context = await loadRequestContext({
      authorizationHeader: "Guest " + fixture.guestToken,
      sessionToken: undefined, csrfTokenHeader: undefined, originHeader: undefined,
      refererHeader: undefined, secFetchSiteHeader: undefined,
    });
    assert.equal(context.userId, fixture.target);
    assert.equal(getClientAccountIdentity(context).originalClientUserId, fixture.source);
    assert.equal(getClientAccountIdentity(context).canonicalAccountId, fixture.target);
    assert.equal(context.preferences.analyticsConsent, "declined");
    assert.equal(context.preferences.productAnalyticsEnabled, false);
    assert.deepEqual(await recordAiConsent(fixture.target, input, fixture.guestSession), originalReceipt);
    const withdrawal = { ...input, eventId: randomUUID(), decisionSequence: 3 };
    const receipt = await recordAiConsent(fixture.target, withdrawal, fixture.guestSession);
    assert.deepEqual(await recordAiConsent(fixture.target, withdrawal, fixture.guestSession), receipt);
    assert.deepEqual(await updateGuestSessionAnalyticsPreferences(fixture.target, fixture.guestSession,
      { analyticsConsent: "declined", productAnalyticsEnabled: false }),
    { analyticsConsent: "declined", productAnalyticsEnabled: false });
    assert.deepEqual(await updateGuestSessionAnalyticsPreferences(fixture.target, fixture.guestSession,
      { analyticsConsent: "granted", productAnalyticsEnabled: true }),
    { analyticsConsent: "granted", productAnalyticsEnabled: true });
    await owner.query("UPDATE org.user_settings SET analytics_consent='granted',product_analytics_enabled=true WHERE user_id=$1", [fixture.target]);
    const enabledContext = await loadRequestContext({
      authorizationHeader: "Guest " + fixture.guestToken,
      sessionToken: undefined, csrfTokenHeader: undefined, originHeader: undefined,
      refererHeader: undefined, secFetchSiteHeader: undefined,
    });
    assert.equal(enabledContext.preferences.productAnalyticsEnabled, true);
    const now = new Date();
    const event: ClientProductAnalyticsEventRow = {
      eventId: eventIds[0], schemaVersion: productAnalyticsSchemaVersion, eventName: "screen_viewed",
      origin: "client", backfillId: null, clientOccurredAt: now, clientSentAt: now,
      serverReceivedAt: now, occurredAt: now, userId: enabledContext.userId,
      subjectUserId: enabledContext.subjectUserId, authTransport: "guest", trustLevel: "guest_client",
      guestSessionId: fixture.guestSession, workspaceId: enabledContext.selectedWorkspaceId,
      anonymousId, sessionId: null, platform: "ios", appVersion: "1.35.0",
      osVersion: null, deviceModel: null, osName: null, deviceType: null, deviceLocale: null,
      timezone: null, country: null, uiLocale: "en", networkState: null, screen: "review",
      eventProperties: {}, experimentAssignments: {}, requestId: null, details: null,
      automatedClient: null, networkAsn: null, userAgentChromeMajor: null, clientHintChromiumMajor: null,
    };
    const installation: ProductAnalyticsInstallationObservation = {
      anonymousId, platform: "ios", userId: enabledContext.userId,
      guestSessionId: fixture.guestSession, appVersion: "1.35.0",
      context: { osVersion: null, deviceModel: null, osName: null, deviceType: null, deviceLocale: null, timezone: null },
      observedAt: now, countryLookup: null,
    };
    assert.equal((await insertProductAnalyticsClientBatch([event], null, installation)).storedEventCount, 1);
    assert.equal((await insertProductAnalyticsClientBatch([{ ...event, eventId: eventIds[1] }], null, null)).storedEventCount, 1);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM analytics.product_events WHERE event_id=ANY($1::uuid[]) AND user_id=$2::uuid",
      [eventIds, fixture.target])).rows[0].count, 2);
    assert.equal((await owner.query("SELECT user_id::text FROM analytics.installation_profiles WHERE anonymous_id=$1", [anonymousId])).rows[0].user_id, fixture.target);
    const consumerActions = [
      { run: () => recordAiConsent(fixture!.target, withdrawal, fixture!.guestSession), code: "AI_CONSENT_IDENTITY_DELETED" },
      { run: () => updateGuestSessionAnalyticsPreferences(fixture!.target, fixture!.guestSession,
        { analyticsConsent: "declined", productAnalyticsEnabled: null }), code: "GUEST_AUTH_INVALID" },
      { run: () => updateGuestSessionAnalyticsPreferences(fixture!.target, fixture!.guestSession,
        { analyticsConsent: null, productAnalyticsEnabled: false }), code: "GUEST_AUTH_INVALID" },
      { run: () => insertProductAnalyticsClientBatch([event], null, installation), code: "GUEST_AUTH_INVALID" },
      { run: () => insertProductAnalyticsClientBatch([event], null, null), code: "GUEST_AUTH_INVALID" },
    ];
    await owner.query("UPDATE auth.user_identities SET created_at=now()-interval '8 days' WHERE provider_subject=$1", [fixture.subjects[0]]);
    for (const action of consumerActions) await assert.rejects(action.run(), { code: action.code });
    await owner.query("UPDATE auth.user_identities SET created_at=now()-interval '1 day' WHERE provider_subject=$1", [fixture.subjects[0]]);
    await owner.query("UPDATE auth.guest_sessions SET revoked_at=now() WHERE session_id=$1", [fixture.guestSession]);
    for (const action of consumerActions) await assert.rejects(action.run(), { code: action.code });
    await owner.query("UPDATE auth.guest_sessions SET revoked_at=NULL WHERE session_id=$1", [fixture.guestSession]);
    await owner.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [hash(fixture.target)]);
    for (const action of consumerActions) await assert.rejects(action.run(), { code: action.code });
    await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256=$1", [hash(fixture.target)]);
    for (const action of [
      async (): Promise<void> => {
        await prepareGuestUpgradeInExecutor(executor(runtime), fixture!.guestToken, fixture!.subjects[0], null);
      },
      async (): Promise<void> => {
        await completeGuestUpgradeInExecutor(executor(runtime), fixture!.guestToken, fixture!.subjects[0],
          { type: "existing", workspaceId: fixture!.workspaceIds[1] }, capabilities);
      },
    ]) {
      await runtime.query("BEGIN");
      await assert.rejects(action(), { code: "GUEST_AUTH_INVALID" });
      await runtime.query("ROLLBACK");
    }
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [fixture.workspaceIds])).rows[0].count, 3);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.guest_upgrade_history WHERE source_guest_user_id=$1", [fixture.source])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT user_id FROM auth.guest_sessions WHERE session_id=$1", [fixture.guestSession])).rows[0].user_id, fixture.source);
    await runtime.query("BEGIN");
    await runtime.query("SELECT auth.lock_account_lifecycle($1)", [fixture.target]);
    await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: fixture.target });
    await runtime.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [hash(fixture.target)]);
    await deleteRealAccountDataInExecutor(executor(runtime), fixture.target);
    await runtime.query("COMMIT");
    for (const action of consumerActions.slice(0, 3)) await assert.rejects(action.run(), { code: action.code });
    await assert.rejects(insertProductAnalyticsClientBatch([event], null, installation), { code: "ANALYTICS_OWNER_DELETED" });
    await assert.rejects(insertProductAnalyticsClientBatch([event], null, null), { code: "ANALYTICS_OWNER_DELETED" });
  } finally {
    try {
      await runtime.query("ROLLBACK");
      await owner.query("DELETE FROM analytics.product_events WHERE event_id=ANY($1::uuid[])", [eventIds]);
      await owner.query("DELETE FROM analytics.installation_profiles WHERE anonymous_id=$1", [anonymousId]);
      if (fixture !== undefined) await remove(owner, fixture);
      await Promise.all([owner.end(), runtime.end()]);
    } finally {
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
      resetAuthConfigForTests();
    }
  }
});

test("committed guest history replay normalizes authorization and workspace summary while preserving original result ids", async () => {
  const owner = connection();
  const runtime = connection();
  let fixture: Fixture | undefined;
  const guest = randomUUID();
  const session = randomUUID();
  const token = randomUUID();
  const upgrade = randomUUID();
  try {
    await Promise.all([owner.connect(), runtime.connect()]);
    await owner.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE backend_app");
    fixture = await seed(owner);
    await owner.query(`INSERT INTO auth.guest_upgrade_history(upgrade_id,source_guest_user_id,source_guest_workspace_id,
      source_guest_session_id,source_guest_session_secret_hash,target_subject_user_id,target_user_id,target_workspace_id,selection_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'existing')`,
    [upgrade, guest, randomUUID(), session, hash(token), fixture.subjects[0], fixture.source, fixture.workspaceIds[2]]);
    const history = (await owner.query("SELECT to_jsonb(r) AS retained FROM auth.guest_upgrade_history r WHERE upgrade_id=$1", [upgrade])).rows;
    await combine(owner, fixture, await preview(owner, fixture));
    await runtime.query("BEGIN");
    const record = await loadGuestUpgradeReplayInExecutor(executor(runtime), session);
    assert.equal(record?.targetUserId, fixture.source);
    assert.equal(record?.canonicalTargetUserId, fixture.target);
    const replay = await completeGuestUpgradeInExecutor(executor(runtime), token, fixture.subjects[0],
      { type: "existing", workspaceId: fixture.workspaceIds[2] }, capabilities);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.equal(replay.targetUserId, fixture.source);
    assert.equal(replay.targetWorkspaceId, fixture.workspaceIds[2]);
    assert.equal(replay.guestUserId, guest);
    await runtime.query("ROLLBACK");
    assert.deepEqual((await owner.query("SELECT to_jsonb(r) AS retained FROM auth.guest_upgrade_history r WHERE upgrade_id=$1", [upgrade])).rows, history);
  } finally {
    await runtime.query("ROLLBACK");
    await owner.query("DELETE FROM auth.guest_upgrade_history WHERE upgrade_id=$1", [upgrade]);
    if (fixture !== undefined) await remove(owner, fixture);
    await Promise.all([owner.end(), runtime.end()]);
  }
});

test("later permanent deletion erases retired shells and all person histories while preserving shared workspace replicas", async () => {
  const owner = connection();
  const runtime = connection();
  let fixture: Fixture | undefined;
  const earlierGuest = randomUUID();
  const linkedGuest = randomUUID();
  const unrelatedAnonymous = randomUUID();
  const upgrade = randomUUID();
  const eventIds = Array.from({ length: 5 }, () => randomUUID());
  const anonymousInstallation = randomUUID();
  let anonymized: string | null = null;
  try {
    await Promise.all([owner.connect(), runtime.connect()]);
    await owner.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE backend_app");
    fixture = await seed(owner);
    await owner.query(`INSERT INTO auth.guest_upgrade_history(upgrade_id,source_guest_user_id,source_guest_workspace_id,
      source_guest_session_id,target_subject_user_id,target_user_id,target_workspace_id,selection_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'existing')`,
    [upgrade, earlierGuest, randomUUID(), randomUUID(), fixture.subjects[0], fixture.source, fixture.workspaceIds[2]]);
    await owner.query(`INSERT INTO analytics.identity_links(link_id,anonymous_id,user_id,source)
      VALUES ($1,$2,$3,'server_derived'),($4,$5,$6,'authenticated_client')`,
    [randomUUID(), linkedGuest, earlierGuest, randomUUID(), unrelatedAnonymous, fixture.target]);
    const personIds = [fixture.source, fixture.target, earlierGuest, linkedGuest];
    for (const [index, user] of [...personIds, unrelatedAnonymous].entries()) {
      await owner.query(`INSERT INTO analytics.product_events(event_id,schema_version,event_name,origin,
        server_received_at,occurred_at,user_id,subject_user_id,trust_level,event_properties)
        VALUES ($1,1,'account_deleted','server',now(),now(),$2,$2,'server_derived','{}')`, [eventIds[index], user]);
    }
    await owner.query(`INSERT INTO analytics.installation_profiles(anonymous_id,platform,user_id,first_seen,last_seen)
      VALUES ($1,'ios',$2,now(),now())`, [anonymousInstallation, fixture.source]);
    for (const user of personIds) {
      await owner.query(`INSERT INTO analytics.excluded_actors(actor_id,excluded_by,reason,source,restored_at,restored_by)
        VALUES ($1,'fixture','fixture','manual',now(),'fixture')`, [user]);
    }
    // Keep pre-union guest facts under their historical owners to exercise the recursive edge walk.
    await owner.query("UPDATE ai.usage_events SET user_id=$2 WHERE usage_event_id=$1", [fixture.usage[0], earlierGuest]);
    await combine(owner, fixture, await preview(owner, fixture));
    const exclusionBefore = (await owner.query("SELECT * FROM analytics.excluded_actors WHERE actor_id=ANY($1::text[]) ORDER BY actor_id", [personIds])).rows;
    assert.equal(exclusionBefore.length, 4);
    assert.equal((await owner.query("SELECT user_id FROM analytics.product_events WHERE event_id=$1", [eventIds[0]])).rows[0].user_id, fixture.source);
    await runtime.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: fixture.target });
    await assert.rejects(runtime.query("SELECT auth.erase_retired_account_shells()"), { code: "42501" });
    await runtime.query("ROLLBACK");
    await runtime.query("BEGIN");
    await runtime.query("SELECT auth.lock_account_lifecycle($1)", [fixture.target]);
    await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: fixture.target });
    await runtime.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [hash(fixture.target)]);
    await deleteRealAccountDataInExecutor(executor(runtime), fixture.target);
    await runtime.query("COMMIT");
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.user_settings WHERE user_id=ANY($1::text[])", [[fixture.source, fixture.target]])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.guest_sessions WHERE session_id=$1", [fixture.guestSession])).rows[0].count, 0);
    for (const user of [fixture.source, fixture.target]) {
      assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.deleted_accounts WHERE user_id_sha256=$1", [hash(user)])).rows[0].count, 1);
    }
    const usage = await owner.query<Readonly<{ user_id: string; workspace_id: string | null; request_id: string | null }>>(
      "SELECT user_id,workspace_id,request_id FROM ai.usage_events WHERE usage_event_id=ANY($1::uuid[])", [fixture.usage]);
    anonymized = usage.rows[0].user_id;
    assert.ok(!personIds.includes(anonymized));
    assert.ok(usage.rows.every((row) => row.user_id === anonymized && row.workspace_id === null && row.request_id === null));
    assert.equal((await owner.query("SELECT user_id FROM billing.purchases WHERE purchase_id=$1", [fixture.purchase])).rows[0].user_id, anonymized);
    assert.equal((await owner.query("SELECT user_id FROM billing.history_subjects WHERE subject_hash=$1", [hash(fixture.purchase)])).rows[0].user_id, anonymized);
    assert.deepEqual((await owner.query("SELECT DISTINCT user_id::text,identity_state FROM analytics.product_events WHERE event_id=ANY($1::uuid[])", [eventIds.slice(0, 4)])).rows,
      [{ user_id: anonymized, identity_state: "anonymized" }]);
    assert.equal((await owner.query("SELECT user_id FROM analytics.product_events WHERE event_id=$1", [eventIds[4]])).rows[0].user_id, unrelatedAnonymous);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM analytics.identity_links WHERE user_id=ANY($1::uuid[])", [personIds])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM analytics.installation_profiles WHERE anonymous_id=$1", [anonymousInstallation])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM analytics.excluded_actors WHERE actor_id=ANY($1::text[])", [personIds])).rows[0].count, 0);
    assert.deepEqual((await owner.query("SELECT user_id FROM org.workspace_memberships WHERE workspace_id=$1", [fixture.workspaceIds[2]])).rows,
      [{ user_id: fixture.friend }]);
    assert.equal((await owner.query("SELECT replica_id FROM sync.workspace_replicas WHERE replica_id=$1", [fixture.replica])).rows[0].replica_id, fixture.replica);
    assert.equal((await owner.query("SELECT last_operation_id FROM content.cards WHERE card_id=$1", [fixture.card])).rows[0].last_operation_id, "immutable-operation");
    await assert.rejects(authenticateGuestSession(fixture.guestToken), { code: "GUEST_AUTH_INVALID" });
  } finally {
    await runtime.query("ROLLBACK");
    await owner.query("DELETE FROM analytics.product_events WHERE event_id=ANY($1::uuid[]) OR user_id=$2::uuid", [eventIds, anonymized]);
    await owner.query("DELETE FROM analytics.identity_links WHERE user_id=ANY($1::uuid[])", [[earlierGuest, linkedGuest, fixture?.target ?? unrelatedAnonymous]]);
    await owner.query("DELETE FROM analytics.installation_profiles WHERE anonymous_id=$1", [anonymousInstallation]);
    await owner.query("DELETE FROM auth.guest_upgrade_history WHERE upgrade_id=$1", [upgrade]);
    if (fixture !== undefined) await remove(owner, fixture);
    await Promise.all([owner.end(), runtime.end()]);
  }
});

test("only proved-unused surplus starters are hidden and an all-starter union retains one destination", async () => {
  const owner = connection();
  const runtime = connection();
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const subjects = users.map(() => randomUUID());
  const workspaces = Array.from({ length: 3 }, () => randomUUID());
  const operation = randomUUID();
  const unknownOperation = randomUUID();
  try {
    await Promise.all([owner.connect(), runtime.connect()]);
    await owner.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE backend_app");
    await owner.query("BEGIN");
    for (const [index, user] of users.slice(0, 2).entries()) {
      await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [user]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subjects[index], user]);
      await owner.query(`INSERT INTO org.workspaces(workspace_id,name,creation_origin,fsrs_client_updated_at,
        fsrs_last_modified_by_replica_id,fsrs_last_operation_id)
        VALUES ($1,'Personal','automatic_starter',now(),$1,'seed')`, [workspaces[index]]);
      await owner.query(`INSERT INTO sync.workspace_replicas(replica_id,workspace_id,user_id,actor_kind,actor_key,platform)
        VALUES ($1,$1,$2,'workspace_seed','seed','system')`, [workspaces[index], user]);
      await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [workspaces[index], user]);
      await owner.query("UPDATE org.user_settings SET workspace_id=$2 WHERE user_id=$1", [user, workspaces[index]]);
    }
    await owner.query("COMMIT");
    const authorized = (await owner.query<Readonly<{ preview: Preview }>>(previewSql, [...users.slice(0, 2), 100, 8])).rows[0].preview;
    assert.equal(authorized.selectedWorkspaceId, workspaces[1]);
    assert.deepEqual(authorized.suppressedWorkspaceIds, [workspaces[0]]);
    const result = (await owner.query<Readonly<{ result: Result }>>(combineSql, [operation, ...users.slice(0, 2), JSON.stringify(authorized)])).rows[0].result;
    assert.equal(result.selectedWorkspaceId, workspaces[1]);
    await runtime.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: users[1] });
    assert.deepEqual((await runtime.query("SELECT workspace_id FROM org.visible_workspace_ids($1)", [workspaces[1]])).rows,
      [{ workspace_id: workspaces[1] }]);
    await runtime.query("ROLLBACK");
    // A meaningful write makes a suppressed root visible again without changing its backing ID.
    await owner.query("UPDATE org.workspaces SET name='Adopted workspace' WHERE workspace_id=$1", [workspaces[0]]);
    await runtime.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executor(runtime), { userId: users[1] });
    assert.equal((await runtime.query("SELECT workspace_id FROM org.visible_workspace_ids($1)", [workspaces[1]])).rowCount, 2);
    await runtime.query("ROLLBACK");

    // Unknown provenance is retained even when every current value resembles a starter.
    await owner.query("BEGIN");
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [users[2]]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subjects[2], users[2]]);
    await owner.query(`INSERT INTO org.workspaces(workspace_id,name,fsrs_client_updated_at,
      fsrs_last_modified_by_replica_id,fsrs_last_operation_id) VALUES ($1,'Personal',now(),$1,'seed')`, [workspaces[2]]);
    await owner.query(`INSERT INTO sync.workspace_replicas(replica_id,workspace_id,user_id,actor_kind,actor_key,platform)
      VALUES ($1,$1,$2,'workspace_seed','seed','system')`, [workspaces[2], users[2]]);
    await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [workspaces[2], users[2]]);
    await owner.query("COMMIT");
    const unknown = (await owner.query<Readonly<{ preview: Preview }>>(previewSql, [users[2], users[1], 100, 8])).rows[0].preview;
    assert.ok(!unknown.suppressedWorkspaceIds.includes(workspaces[2]));
    await owner.query(combineSql, [unknownOperation, users[2], users[1], JSON.stringify(unknown)]);
    assert.equal((await owner.query("SELECT starter_suppressed_at FROM org.workspaces WHERE workspace_id=$1", [workspaces[2]])).rows[0].starter_suppressed_at, null);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaces])).rows[0].count, 3);
  } finally {
    await runtime.query("ROLLBACK");
    await owner.query("ROLLBACK");
    await owner.query("DELETE FROM auth.account_union_receipts WHERE operation_id=ANY($1::uuid[])", [[operation, unknownOperation]]);
    await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id=ANY($1::text[])", [users]);
    await owner.query("DELETE FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaces]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [users]);
    await Promise.all([owner.end(), runtime.end()]);
  }
});

test("a later union flattens original aliases while an earlier operation still replays its exact durable result", async () => {
  const owner = connection();
  let fixture: Fixture | undefined;
  const laterSubject = randomUUID();
  try {
    await owner.connect();
    await owner.query("SET statement_timeout='10s'");
    fixture = await seed(owner);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [laterSubject, fixture.friend]);
    const authorized = await preview(owner, fixture);
    const original = await combine(owner, fixture, authorized);
    const later = { ...fixture, source: fixture.target, target: fixture.friend, operation: randomUUID() };
    await combine(owner, later, await preview(owner, later));
    assert.deepEqual((await owner.query("SELECT retired_user_id,canonical_user_id FROM auth.account_retirements WHERE retired_user_id=ANY($1::text[]) ORDER BY retired_user_id", [[fixture.source, fixture.target]])).rows,
      [fixture.source, fixture.target].sort().map((id) => ({ retired_user_id: id, canonical_user_id: fixture!.friend })));
    assert.deepEqual(await combine(owner, fixture, authorized), original);
    const mapping = await loadCognitoIdentityMappingInExecutor(executor(owner), fixture.subjects[0]);
    assert.equal(mapping?.originalClientUserId, fixture.source);
    assert.equal(mapping?.userId, fixture.friend);
    assert.equal((await owner.query("SELECT user_id FROM auth.guest_sessions WHERE session_id=$1", [fixture.guestSession])).rows[0].user_id, fixture.source);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.account_union_receipts WHERE target_user_id=ANY($1::text[])", [[fixture.target, fixture.friend]])).rows[0].count, 2);
  } finally {
    if (fixture !== undefined) await remove(owner, fixture);
    await owner.end();
  }
});

test("a concurrent identical commit returns the persisted receipt after the subject lock releases", async () => {
  const owner = connection();
  const contender = connection();
  const observer = connection();
  let fixture: Fixture | undefined;
  try {
    await Promise.all([owner.connect(), contender.connect(), observer.connect()]);
    for (const client of [owner, contender, observer]) await client.query("SET statement_timeout='10s'");
    fixture = await seed(owner);
    const authorized = await preview(owner, fixture);
    await owner.query("BEGIN");
    const original = await combine(owner, fixture, authorized);
    const ownerPid = (await owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const contenderPid = (await contender.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const waiting = Promise.allSettled([combine(contender, fixture, authorized)]);
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        blocked = (await observer.query("SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked", [ownerPid, contenderPid])).rows[0].blocked as boolean;
        if (blocked) break;
        await delay(10);
      }
      assert.equal(blocked, true);
    } finally {
      await owner.query("COMMIT");
    }
    const [finished] = await waiting;
    if (finished.status === "rejected") throw finished.reason;
    assert.deepEqual(finished.value, original);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.account_union_receipts WHERE operation_id=$1", [fixture.operation])).rows[0].count, 1);
  } finally {
    await Promise.all([owner.query("ROLLBACK"), contender.query("ROLLBACK")]);
    if (fixture !== undefined) await remove(owner, fixture);
    await Promise.all([owner.end(), contender.end(), observer.end()]);
  }
});
