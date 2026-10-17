import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Hono } from "hono";
import pg from "pg";
import { createAgentApiKeyForUser } from "../agent/apiKeys";
import type { AgentEnvelope } from "../agent/envelope";
import { resetAuthConfigForTests } from "../auth/config";
import { applyUserDatabaseScopeInExecutor, transactionWithUserScope, type DatabaseExecutor } from "../database";
import { hashGuestToken } from "../guestAuth/shared";
import { createAgentRoutes } from "../routes/agent";
import { createWorkspaceRoutes } from "../routes/workspaces";
import type { AppEnv } from "../server/app";
import type { CursorPageInput } from "../shared/pagination";
import { createWorkspaceInExecutor } from "./create";
import {
  listAuthorizedUserWorkspacesPageForSelectedWorkspace,
  listUserWorkspaceIdsInExecutor,
  listUserWorkspacesForSelectedWorkspace,
  listUserWorkspacesPageForSelectedWorkspace,
  listUserWorkspacesWithStatsForSelectedWorkspace,
} from "./queries";
import {
  assertUserHasWorkspaceAccess,
  ensureApiKeyWorkspaceSelection,
  ensureMcpConnectionWorkspaceSelection,
  ensureUserSelectedWorkspaceInExecutor,
} from "./selection";
import type { AuthorizedWorkspaceSummaryPage, WorkspaceSummaryPage } from "./types";
import { parseSyncPullInput, parseSyncPushInput, processSyncPull, processSyncPush } from "../sync";
import { createCatalogPackageVersionFromWorkspaceSelectionInExecutor } from "../catalog/authoring/versions/workspaceSnapshots";

type AuthWorkspaceStore = Readonly<{
  ensureUserSettingsAndSelectWorkspace: (
    executor: DatabaseExecutor, userId: string, email: string,
  ) => Promise<string | null>;
}>;

function executorFor(client: pg.Client): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

test("starter omission preserves complete membership, runtime defaults and late explicit-ID sync", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const [userId, foreignId, fallbackId] = [randomUUID(), randomUUID(), randomUUID()];
  const workspaceIds: string[] = [];
  const connectionIds = [randomUUID(), randomUUID()];
  const clientId = randomUUID();
  const installationId = randomUUID();
  const catalogAuthorId = randomUUID();
  const catalogPackageId = randomUUID();
  const catalogVersionId = randomUUID();
  const previousAuthMode = process.env.AUTH_MODE;
  try {
    await Promise.all([owner.connect(), backend.connect(), auth.connect()]);
    await backend.query("SET ROLE backend_app");
    await auth.query("SET ROLE auth_app");
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1),($2),($3)", [userId, foreignId, fallbackId]);
    const create = async (accountId: string, cause: "automatic_starter" | "explicit"): Promise<string> => {
      const id = await transactionWithUserScope({ userId: accountId }, (executor) =>
        createWorkspaceInExecutor(executor, accountId, { name: "Personal", cause }));
      workspaceIds.push(id);
      return id;
    };
    const hidden = await create(userId, "automatic_starter");
    const visible = await create(userId, "explicit");
    const foreign = await create(foreignId, "automatic_starter");
    const fallback = await create(fallbackId, "automatic_starter");
    const fallbackSurplus = await create(fallbackId, "automatic_starter");
    const guestToken = randomUUID();
    await owner.query("INSERT INTO auth.guest_sessions(session_id,session_secret_hash,user_id,platform) VALUES ($1,$2,$3,'android')",
      [randomUUID(), hashGuestToken(guestToken), userId]);
    await owner.query("UPDATE org.user_settings SET workspace_id = $2 WHERE user_id = $1", [userId, visible]);
    process.env.AUTH_MODE = "cognito";
    resetAuthConfigForTests();
    const app = new Hono<AppEnv>();
    app.use("*", async (context, next) => {
      context.set("requestId", randomUUID());
      await next();
    });
    app.route("/v1", createWorkspaceRoutes({ allowedOrigins: [] }));
    app.route("/v1", createAgentRoutes({ allowedOrigins: [] }));
    const listHumanPage = async (input: CursorPageInput): Promise<AuthorizedWorkspaceSummaryPage> => {
      const query = new URLSearchParams({ limit: String(input.limit) });
      if (input.cursor !== null) query.set("cursor", input.cursor);
      const response = await app.request(`http://localhost/v1/workspaces?${query}`, {
        headers: { Authorization: `Guest ${guestToken}` },
      });
      assert.equal(response.status, 200);
      return await response.json() as AuthorizedWorkspaceSummaryPage;
    };
    await owner.query("UPDATE org.workspaces SET created_at = '2026-01-01' WHERE workspace_id = ANY($1::uuid[])", [[hidden, fallback]]);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [hidden])).rows[0].unused, true);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, null)).length, 2);

    // Only the test owner marks surplus; production marking belongs to locked union/consent.
    await owner.query("UPDATE org.workspaces SET starter_suppressed_at = now() WHERE workspace_id = ANY($1::uuid[])",
      [[hidden, fallback, fallbackSurplus]]);
    assert.deepEqual((await listUserWorkspacesForSelectedWorkspace(userId, null)).map((row) => row.workspaceId), [visible]);
    assert.deepEqual((await listUserWorkspacesForSelectedWorkspace(fallbackId, null)).map((row) => row.workspaceId), [fallback]);
    assert.deepEqual((await listUserWorkspacesForSelectedWorkspace(fallbackId, fallbackSurplus)).map((row) => row.workspaceId), [fallbackSurplus]);
    assert.deepEqual((await listUserWorkspacesForSelectedWorkspace(userId, foreign)).map((row) => row.workspaceId), [visible]);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, hidden)).find((row) => row.workspaceId === hidden)?.isSelected, true);
    const hiddenPage = await listHumanPage({ limit: 1, cursor: null });
    assert.deepEqual(hiddenPage.workspaces, [{
      workspaceId: hidden, name: "Personal", createdAt: "2026-01-01T00:00:00.000Z",
      isSelected: false, isVisible: false,
    }]);
    assert.ok(hiddenPage.nextCursor !== null);
    const visiblePage = await listHumanPage({ limit: 1, cursor: hiddenPage.nextCursor });
    assert.deepEqual(visiblePage.workspaces.map((row) => [row.workspaceId, row.isSelected, row.isVisible]), [[visible, true, true]]);
    assert.equal(visiblePage.nextCursor, null);
    const selectedPage = await listAuthorizedUserWorkspacesPageForSelectedWorkspace(userId, hidden, { limit: 100, cursor: null });
    assert.deepEqual(selectedPage.workspaces.map((row) => [row.workspaceId, row.isSelected, row.isVisible]),
      [[hidden, true, true], [visible, false, true]]);
    const foreignSelectionPage = await listAuthorizedUserWorkspacesPageForSelectedWorkspace(userId, foreign, { limit: 100, cursor: null });
    assert.deepEqual(foreignSelectionPage.workspaces.map((row) => [row.workspaceId, row.isSelected, row.isVisible]),
      [[hidden, false, false], [visible, false, true]]);
    for (const selected of [null, fallbackSurplus]) {
      const fallbackPage = await listAuthorizedUserWorkspacesPageForSelectedWorkspace(fallbackId, selected, { limit: 100, cursor: null });
      assert.deepEqual(fallbackPage.workspaces.map((row) => [row.workspaceId, row.isVisible]),
        [[fallback, selected === null], [fallbackSurplus, selected === fallbackSurplus]]);
    }
    await transactionWithUserScope({ userId }, async (executor) => {
      assert.equal((await listUserWorkspaceIdsInExecutor(executor, userId)).length, 2);
      assert.equal(await ensureUserSelectedWorkspaceInExecutor(executor, userId, hidden), hidden);
      assert.equal(await ensureUserSelectedWorkspaceInExecutor(executor, userId, foreign), visible);
    });

    await owner.query("INSERT INTO auth.agent_api_keys(connection_id,user_id,label,key_id,key_hash) VALUES ($1,$2,'fixture',$3,$3)",
      [connectionIds[0], userId, randomUUID()]);
    await owner.query("INSERT INTO auth.oauth_clients(client_id,redirect_uris,token_endpoint_auth_method) VALUES ($1,ARRAY['https://client.test/callback'],'none')", [clientId]);
    await owner.query("INSERT INTO auth.oauth_connections(connection_id,user_id,client_id,label) VALUES ($1,$2,$3,'fixture')",
      [connectionIds[1], userId, clientId]);
    assert.equal(await ensureApiKeyWorkspaceSelection(userId, connectionIds[0], null), visible);
    assert.equal(await ensureMcpConnectionWorkspaceSelection(userId, connectionIds[1], null), visible);
    assert.equal(await ensureApiKeyWorkspaceSelection(userId, connectionIds[0], hidden), hidden);
    assert.equal(await ensureMcpConnectionWorkspaceSelection(userId, connectionIds[1], hidden), hidden);
    const authStore = await import(pathToFileURL(resolve(__dirname, "../../../auth/src/server/agent/userWorkspace.ts")).href) as AuthWorkspaceStore;
    await auth.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(auth), { userId });
    assert.equal(await authStore.ensureUserSettingsAndSelectWorkspace(executorFor(auth), userId, "starter@mail.test"), visible);
    await auth.query("COMMIT");

    for (const client of [backend, auth]) {
      await assert.rejects(client.query("SELECT org.workspace_is_unused_starter($1)", [foreign]), { code: "42501" });
      if (client === auth) {
        await assert.rejects(client.query("SELECT front_text FROM content.cards"), { code: "42501" });
      } else {
        assert.deepEqual((await client.query("SELECT front_text FROM content.cards")).rows, []);
      }
      await client.query("BEGIN READ ONLY");
      await applyUserDatabaseScopeInExecutor(executorFor(client), { userId: foreignId });
      assert.deepEqual((await client.query("SELECT workspace_id FROM org.visible_workspace_ids($1)", [hidden])).rows,
        [{ workspace_id: foreign }]);
      await client.query("ROLLBACK");
      assert.deepEqual((await client.query("SELECT workspace_id FROM org.visible_workspace_ids($1)", [hidden])).rows, []);
    }

    const hiddenPrefix: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const id = await create(userId, "automatic_starter");
      hiddenPrefix.push(id);
      await owner.query("UPDATE org.workspaces SET created_at = '2026-01-02', starter_suppressed_at = now() WHERE workspace_id = $1", [id]);
    }
    const secondVisible = await create(userId, "explicit");
    await owner.query("UPDATE org.workspaces SET created_at = '2026-02-01' WHERE workspace_id = $1", [visible]);
    await owner.query("UPDATE org.workspaces SET created_at = '2026-02-02' WHERE workspace_id = $1", [secondVisible]);
    const page = await listUserWorkspacesPageForSelectedWorkspace(userId, null, { limit: 1, cursor: null });
    assert.deepEqual(page.workspaces.map((row) => row.workspaceId), [visible]);
    assert.ok(page.nextCursor !== null);
    const nextPage = await listUserWorkspacesPageForSelectedWorkspace(userId, null, { limit: 1, cursor: page.nextCursor });
    assert.deepEqual(nextPage.workspaces.map((row) => row.workspaceId), [secondVisible]);
    assert.equal(nextPage.nextCursor, null);
    assert.equal((await listUserWorkspacesWithStatsForSelectedWorkspace(userId, null)).length, 2);
    const firstHumanPage = await listHumanPage({ limit: 100, cursor: null });
    assert.equal(firstHumanPage.workspaces.length, 100);
    assert.ok(firstHumanPage.nextCursor !== null);
    assert.ok(firstHumanPage.workspaces.every((row) => row.isVisible === false));
    const lastHumanPage = await listHumanPage({ limit: 100, cursor: firstHumanPage.nextCursor });
    assert.equal(lastHumanPage.nextCursor, null);
    const authorized = [...firstHumanPage.workspaces, ...lastHumanPage.workspaces];
    assert.deepEqual(authorized.map((row) => row.workspaceId), [hidden, ...hiddenPrefix.sort(), visible, secondVisible]);
    assert.deepEqual(authorized.filter((row) => row.isVisible).map((row) => row.workspaceId), [visible, secondVisible]);
    assert.deepEqual(authorized.filter((row) => row.isSelected).map((row) => row.workspaceId), [visible]);
    const key = await createAgentApiKeyForUser(userId, "visible-list-fixture");
    for (const path of ["/v1/workspaces", "/v1/agent/workspaces"]) {
      const response = await app.request(`http://localhost${path}?limit=1`, {
        headers: { Authorization: `ApiKey ${key.apiKey}` },
      });
      assert.equal(response.status, 200);
      const envelope = await response.json() as AgentEnvelope<WorkspaceSummaryPage>;
      assert.equal(envelope.ok, true);
      assert.equal(typeof envelope.instructions, "string");
      assert.deepEqual(envelope.data.workspaces.map((row) => row.workspaceId), [visible]);
      const workspace = envelope.data.workspaces[0];
      assert.ok(workspace !== undefined);
      assert.equal("isVisible" in workspace, false);
      assert.equal(envelope.data.nextCursor, page.nextCursor);
    }

    await assertUserHasWorkspaceAccess(userId, hidden);
    const pullInput = parseSyncPullInput({ installationId, platform: "web", afterHotChangeId: 0, limit: 100 });
    const emptyPull = await processSyncPull(hidden, userId, pullInput);
    assert.ok(emptyPull !== undefined);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, null)).some((row) => row.workspaceId === hidden), false);
    assert.equal((await listHumanPage({ limit: 1, cursor: null })).workspaces[0]?.isVisible, false);
    const cardId = randomUUID();
    const snapshot = {
      cardId, frontText: "Demo prompt", backText: "Demo answer", cardType: "basic", tags: ["demo"],
      metadata: { version: 1, source: null, onboardingDemo: {
        version: 1, frontText: "Demo prompt", backText: "Demo answer", cardType: "basic", tags: ["demo"], wasEdited: false,
      } },
      dueAt: null, createdAt: "2026-01-01T00:00:00.000Z", reps: 0, lapses: 0, fsrsCardState: "new",
      fsrsStepIndex: null, fsrsStability: null, fsrsDifficulty: null, fsrsLastReviewedAt: null,
      fsrsScheduledDays: null, deletedAt: null,
    };
    let pushSequence = 0;
    const push = async (payload: typeof snapshot | Omit<typeof snapshot, "metadata">): Promise<void> => {
      const result = await processSyncPush(hidden, userId, parseSyncPushInput({
        installationId, platform: "web", operations: [{
          operationId: randomUUID(), entityId: cardId, clientUpdatedAt: new Date(Date.UTC(2099, 0, 1, 0, pushSequence++)).toISOString(),
          entityType: "card", action: "upsert", payload,
        }],
      }));
      assert.equal(result.operations[0]?.status, "applied");
    };
    await push(snapshot);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [hidden])).rows[0].unused, true);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, null)).some((row) => row.workspaceId === hidden), false);
    assert.equal((await listHumanPage({ limit: 1, cursor: null })).workspaces[0]?.isVisible, false);
    for (const origin of ["unknown", "explicit"]) {
      const preservedId = randomUUID();
      await owner.query("BEGIN");
      try {
        await owner.query(`INSERT INTO org.workspaces
          SELECT (jsonb_populate_record(NULL::org.workspaces, to_jsonb(workspace)
            || jsonb_build_object('workspace_id',$2::uuid,'creation_origin',$3::text))).*
          FROM org.workspaces AS workspace WHERE workspace_id = $1`, [hidden, preservedId, origin]);
        await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [preservedId, userId]);
        assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [preservedId])).rows[0].unused, false);
        await owner.query("SET LOCAL ROLE backend_app");
        await applyUserDatabaseScopeInExecutor(executorFor(owner), { userId });
        assert.ok((await owner.query<{ workspace_id: string }>("SELECT workspace_id FROM org.visible_workspace_ids(NULL)")).rows.some((row) => row.workspace_id === preservedId));
      } finally {
        await owner.query("ROLLBACK");
      }
    }
    const replicaId = (await owner.query("SELECT fsrs_last_modified_by_replica_id AS id FROM org.workspaces WHERE workspace_id = $1", [hidden])).rows[0].id as string;
    const preservationProbes: ReadonlyArray<Readonly<{ label: string; sql: string }>> = [
      { label: "ordinary card", sql: "UPDATE content.cards SET metadata = metadata - 'onboardingDemo' WHERE card_id = $2" },
      { label: "unknown demo version", sql: "UPDATE content.cards SET metadata = jsonb_set(metadata, '{onboardingDemo,version}', '2') WHERE card_id = $2" },
      { label: "malformed metadata", sql: "UPDATE content.cards SET metadata = '[]' WHERE card_id = $2" },
      { label: "malformed demo", sql: "UPDATE content.cards SET metadata = jsonb_set(metadata, '{onboardingDemo}', '42') WHERE card_id = $2" },
      { label: "unknown metadata", sql: "UPDATE content.cards SET metadata = metadata || '{\"future\":true}' WHERE card_id = $2" },
      { label: "unknown card type", sql: "UPDATE content.cards SET card_type = 'future' WHERE card_id = $2" },
      { label: "changed source", sql: "UPDATE content.cards SET metadata = jsonb_set(metadata, '{source}', '{\"label\":\"Mine\"}') WHERE card_id = $2" },
      { label: "changed prompt", sql: "UPDATE content.cards SET front_text = 'Authored prompt' WHERE card_id = $2" },
      { label: "changed answer", sql: "UPDATE content.cards SET back_text = 'Authored answer' WHERE card_id = $2" },
      { label: "changed tags", sql: "UPDATE content.cards SET tags = ARRAY['mine'] WHERE card_id = $2" },
      { label: "sticky edit", sql: "UPDATE content.cards SET metadata = jsonb_set(metadata, '{onboardingDemo,wasEdited}', 'true') WHERE card_id = $2" },
      { label: "malformed edited flag", sql: "UPDATE content.cards SET metadata = jsonb_set(metadata, '{onboardingDemo,wasEdited}', 'null') WHERE card_id = $2" },
      { label: "card tombstone", sql: "UPDATE content.cards SET deleted_at = now() WHERE card_id = $2" },
      { label: "card schedule", sql: `UPDATE content.cards SET due_at = now(), reps = 1, fsrs_card_state = 'review',
        fsrs_stability = 1, fsrs_difficulty = 5, fsrs_last_reviewed_at = now(), fsrs_scheduled_days = 1 WHERE card_id = $2` },
      { label: "multiple demos", sql: `INSERT INTO content.cards
        SELECT (jsonb_populate_record(NULL::content.cards, to_jsonb(card) || jsonb_build_object('card_id', gen_random_uuid()))).*
        FROM content.cards AS card WHERE card_id = $2` },
      { label: "demo review", sql: `INSERT INTO content.review_events
        (review_event_id,workspace_id,card_id,replica_id,client_event_id,rating,reviewed_at_client)
        VALUES (gen_random_uuid(),$1,$2,$3,'demo-review',0,now())` },
      { label: "deck", sql: `INSERT INTO content.decks
        (deck_id,workspace_id,name,filter_definition,client_updated_at,last_modified_by_replica_id,last_operation_id)
        VALUES (gen_random_uuid(),$1,'Saved deck','{}',now(),$3,'deck')` },
      { label: "deck tombstone", sql: `INSERT INTO content.decks
        (deck_id,workspace_id,name,filter_definition,client_updated_at,last_modified_by_replica_id,last_operation_id,deleted_at)
        VALUES (gen_random_uuid(),$1,'Deleted deck','{}',now(),$3,'deck',now())` },
      { label: "empty archived chat", sql: `INSERT INTO ai.chat_sessions(user_id,workspace_id,status,archived_at)
        VALUES ($4,$1,'idle',now())` },
      { label: "sharing", sql: `INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,'local','member')` },
      { label: "non-owner membership", sql: "UPDATE org.workspace_memberships SET role = 'member' WHERE workspace_id = $1" },
      { label: "custom name", sql: "UPDATE org.workspaces SET name = 'My cards' WHERE workspace_id = $1" },
      { label: "custom retention", sql: "UPDATE org.workspaces SET fsrs_desired_retention = 0.95 WHERE workspace_id = $1" },
      { label: "custom learning steps", sql: "UPDATE org.workspaces SET fsrs_learning_steps_minutes = '[2,20]' WHERE workspace_id = $1" },
      { label: "custom relearning steps", sql: "UPDATE org.workspaces SET fsrs_relearning_steps_minutes = '[20]' WHERE workspace_id = $1" },
      { label: "custom interval", sql: "UPDATE org.workspaces SET fsrs_maximum_interval_days = 100 WHERE workspace_id = $1" },
      { label: "custom fuzz", sql: "UPDATE org.workspaces SET fsrs_enable_fuzz = false WHERE workspace_id = $1" },
      { label: "media tombstone", sql: `, blob AS (
          INSERT INTO content.media_blobs(media_blob_id,sha256,mime_type,size_bytes,storage_key)
          VALUES (gen_random_uuid(),encode(public.digest(gen_random_uuid()::text,'sha256'),'hex'),'image/png',1,'media-' || gen_random_uuid())
          RETURNING media_blob_id)
        INSERT INTO content.media_assets
        (media_asset_id,workspace_id,media_blob_id,created_at,client_updated_at,last_modified_by_replica_id,last_operation_id,deleted_at)
        SELECT gen_random_uuid(),$1,media_blob_id,now(),now(),$3,'media',now() FROM blob` },
      { label: "upload", sql: `INSERT INTO content.media_upload_sessions
        (media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,staging_storage_key,blob_storage_key,
         s3_upload_id,mime_type,size_bytes,part_size_bytes,part_count,asset_created_at,client_updated_at,last_modified_by_replica_id,last_operation_id,expires_at)
        SELECT session_id,$1,asset_id,repeat('a',64),
          'media/uploads/workspaces/' || $1 || '/assets/' || asset_id || '/sessions/' || session_id,
          'media/blobs/sha256/aa/aa/' || repeat('a',64),'fixture','image/png',1,1,1,now(),now(),$3,'upload',now()+interval '1 hour'
        FROM (SELECT gen_random_uuid() AS session_id,gen_random_uuid() AS asset_id) AS ids` },
      { label: "pre-upload claim", sql: `INSERT INTO content.media_upload_session_creation_claims
        (claim_token,workspace_id,media_asset_id,claimed_by_user_id,claimed_by_replica_id,state,lease_expires_at,created_at,updated_at)
        VALUES (gen_random_uuid(),$1,gen_random_uuid(),$4,$3,'leased',now()+interval '1 hour',now(),now())` },
      { label: "writer reservation", sql: `, lifecycle AS (
        INSERT INTO content.media_blob_lifecycles(sha256,storage_key,mime_type,size_bytes,normalization_version)
        SELECT sha,'media/blobs/sha256/' || substr(sha,1,2) || '/' || substr(sha,3,2) || '/' || sha,'image/png',1,'passthrough-v1'
        FROM (SELECT encode(public.digest(gen_random_uuid()::text,'sha256'),'hex') AS sha) AS digest RETURNING sha256)
        INSERT INTO content.media_blob_writer_reservations(sha256,writer_kind,workspace_id,media_asset_id,operation_id)
        SELECT sha256,'direct_ingestion',$1,gen_random_uuid(),'reservation' FROM lifecycle` },
      { label: "writer attempt", sql: `INSERT INTO content.media_blob_writer_attempts
        (attempt_token,reservation_token,writer_kind,user_id,workspace_id,media_asset_id,operation_id,replica_id,sha256,blob_storage_key,
         mime_type,size_bytes,requested_normalization_version,normalization_version,asset_created_at,client_updated_at,state,lease_expires_at)
        VALUES (gen_random_uuid(),gen_random_uuid(),'direct_ingestion',$4,$1,gen_random_uuid(),'attempt',$3,repeat('c',64),
          'media/blobs/sha256/cc/cc/' || repeat('c',64),'image/png',1,'passthrough-v1','passthrough-v1',now(),now(),'leased',now()+interval '1 hour')` },
      { label: "promotion job", sql: `INSERT INTO content.generated_media_promotion_jobs
        (job_id,operation_id,workspace_id,card_id,target_side,alt_text,media_asset_id,replica_id,staging_storage_key,blob_storage_key,
         sha256,mime_type,size_bytes,user_id)
        SELECT gen_random_uuid(),operation_id,$1,$2,'back','Image',asset_id,$3,
          'media/uploads/workspaces/' || $1 || '/assets/' || asset_id || '/operations/' || encode(public.digest(operation_id::text,'sha256'),'hex'),
          'media/blobs/sha256/dd/dd/' || repeat('d',64),repeat('d',64),'image/png',1,$4
        FROM (SELECT gen_random_uuid() AS operation_id,gen_random_uuid() AS asset_id) AS ids` },
      { label: "catalog install", sql: `INSERT INTO sync.catalog_package_install_idempotency
        (workspace_id,install_id,package_version_id,installed_at,client_updated_at,last_modified_by_replica_id,operation_id_prefix,
         add_import_tag,remove_tags,install_result)
        VALUES ($1,'install',gen_random_uuid(),now(),now(),$3,'install',false,'{}','{}')` },
    ];
    for (const probe of preservationProbes) {
      await owner.query("BEGIN");
      try {
        await owner.query("WITH fixture AS (SELECT $1::uuid,$2::uuid,$3::uuid,$4::text) " + probe.sql,
          [hidden, cardId, replicaId, userId]);
        assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [hidden])).rows[0].unused, false, probe.label);
        await owner.query("SET LOCAL ROLE backend_app");
        await applyUserDatabaseScopeInExecutor(executorFor(owner), { userId });
        const ids = await owner.query<{ workspace_id: string }>("SELECT workspace_id FROM org.visible_workspace_ids(NULL)");
        assert.ok(ids.rows.some((row) => row.workspace_id === hidden), probe.label);
      } finally {
        await owner.query("ROLLBACK");
      }
    }
    const demoBeforeCatalog = await owner.query("SELECT to_jsonb(card) AS card FROM content.cards AS card WHERE workspace_id = $1", [hidden]);
    assert.equal(demoBeforeCatalog.rows.length, 1);
    await owner.query("INSERT INTO catalog.authors(author_id,slug,display_name) VALUES ($1,$2,'Starter author')",
      [catalogAuthorId, `starter-author-${catalogAuthorId}`]);
    await owner.query(`INSERT INTO catalog.packages
      (package_id,author_id,slug,title,summary,description,language_tags,license,educational_subject)
      VALUES ($1,$2,$3,'Starter snapshot','Starter snapshot','Starter snapshot',ARRAY['en'],'CC0-1.0','Learning')`,
      [catalogPackageId, catalogAuthorId, `starter-package-${catalogPackageId}`]);
    const catalogVersion = await transactionWithUserScope({ userId }, (executor) =>
      createCatalogPackageVersionFromWorkspaceSelectionInExecutor(executor, catalogPackageId, {
        packageVersionId: catalogVersionId, workspaceId: hidden, cardIds: [cardId],
      }, userId, "starter@mail.test"));
    assert.equal(catalogVersion.sourceWorkspaceId, hidden);
    assert.equal(catalogVersion.status, "draft");
    assert.equal(catalogVersion.cardCount, 1);
    assert.deepEqual((await owner.query("SELECT stable_card_key FROM catalog.package_cards WHERE package_version_id = $1", [catalogVersionId])).rows,
      [{ stable_card_key: cardId }]);
    assert.deepEqual((await owner.query("SELECT to_jsonb(card) AS card FROM content.cards AS card WHERE workspace_id = $1", [hidden])).rows,
      demoBeforeCatalog.rows);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [hidden])).rows[0].unused, false);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, null)).some((row) => row.workspaceId === hidden), true);
    await owner.query("BEGIN");
    try {
      await applyUserDatabaseScopeInExecutor(executorFor(owner), { userId });
      for (const status of ["submitted", "approved", "published", "delisted"]) {
        await owner.query(`UPDATE catalog.package_versions SET status = $2::catalog.package_status,
          delisted_at = CASE WHEN $2 = 'delisted' THEN now() ELSE NULL END WHERE package_version_id = $1`,
          [catalogVersionId, status]);
        assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [hidden])).rows[0].unused, false, status);
        assert.ok((await owner.query<{ workspace_id: string }>("SELECT workspace_id FROM org.visible_workspace_ids(NULL)")).rows
          .some((row) => row.workspace_id === hidden), status);
      }
    } finally {
      await owner.query("ROLLBACK");
    }
    await owner.query("DELETE FROM catalog.packages WHERE package_id = $1", [catalogPackageId]);
    await owner.query("DELETE FROM catalog.authors WHERE author_id = $1", [catalogAuthorId]);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [hidden])).rows[0].unused, true);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, null)).some((row) => row.workspaceId === hidden), false);
    const { metadata: demoMetadata, ...legacySnapshot } = snapshot;
    assert.ok(demoMetadata.onboardingDemo !== undefined);
    await push({ ...legacySnapshot, backText: "A real late offline answer" });
    assert.deepEqual((await listHumanPage({ limit: 1, cursor: null })).workspaces, [{
      workspaceId: hidden, name: "Personal", createdAt: "2026-01-01T00:00:00.000Z",
      isSelected: false, isVisible: true,
    }]);
    assert.equal((await listUserWorkspacesForSelectedWorkspace(userId, null)).some((row) => row.workspaceId === hidden), true);
    const latePull = await processSyncPull(hidden, userId, pullInput);
    assert.ok(latePull.changes.some((change) => change.entityId === cardId));
    assert.ok((await owner.query("SELECT starter_suppressed_at FROM org.workspaces WHERE workspace_id = $1", [hidden])).rows[0].starter_suppressed_at !== null);
    await assertUserHasWorkspaceAccess(userId, hidden);
    await assert.rejects(assertUserHasWorkspaceAccess(foreignId, hidden), { code: "WORKSPACE_NOT_FOUND" });
  } finally {
    if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousAuthMode;
    resetAuthConfigForTests();
    try {
      await Promise.all([owner.query("ROLLBACK"), backend.query("ROLLBACK"), auth.query("ROLLBACK")]);
      await owner.query("DELETE FROM catalog.packages WHERE package_id = $1", [catalogPackageId]);
      await owner.query("DELETE FROM catalog.authors WHERE author_id = $1", [catalogAuthorId]);
      await owner.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [workspaceIds]);
      await owner.query("DELETE FROM sync.installations WHERE installation_id = $1", [installationId]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[userId, foreignId, fallbackId]]);
      await owner.query("DELETE FROM auth.oauth_clients WHERE client_id = $1", [clientId]);
    } finally {
      await Promise.all([owner.end(), backend.end(), auth.end()]);
    }
  }
});

