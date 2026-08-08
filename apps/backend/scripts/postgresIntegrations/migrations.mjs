import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pgUtils from "pg/lib/utils.js";
import {
  backendRolePassword,
  createdRolesByMigration,
  disposableDatabaseName,
  managedRoleNames,
} from "./boundaries.mjs";
import { combineErrors, contextualError } from "./errors.mjs";
import { createPostgresClientOptions } from "./connection.mjs";
import {
  createSupervisedPostgresClient,
  requirePostgresSessionContract,
  withPostgresClient,
} from "./supervisedClient.mjs";
import {
  requireConnectedDatabaseIdentityForWork,
  requireOwnedDatabaseIdentityForWork,
} from "./cleanup.mjs";

const { escapeIdentifier, escapeLiteral } = pgUtils;

const scriptDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const backendRoot = dirname(scriptDirectory);
const repositoryRoot = resolve(backendRoot, "..", "..");
const migrationsDirectory = join(repositoryRoot, "db", "migrations");

export async function listMigrationFiles(
  boundaryFileName,
  expectedMigrationCount,
) {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const boundaryIndex = migrationFiles.indexOf(boundaryFileName);
  if (boundaryIndex < 0) {
    throw new Error(
      `PostgreSQL integration migration boundary is missing. boundary=${boundaryFileName}`,
    );
  }
  const boundaryFiles = migrationFiles.slice(0, boundaryIndex + 1);
  if (boundaryFiles.length !== expectedMigrationCount) {
    throw new Error(
      `PostgreSQL integration migration file boundary is invalid. boundary=${boundaryFileName} expectedCount=${expectedMigrationCount} actualCount=${boundaryFiles.length}`,
    );
  }
  return boundaryFiles;
}


async function assertHistoricalSeedBoundary(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM org.user_settings) AS users,
      (SELECT count(*)::int FROM org.user_settings WHERE user_id = 'local') AS local_users,
      (SELECT count(*)::int FROM org.workspaces) AS workspaces,
      (SELECT count(*)::int FROM org.workspace_memberships) AS memberships,
      (SELECT count(*)::int FROM sync.devices) AS devices
  `);
  const state = result.rows[0];
  if (
    state?.users !== 1
    || state.local_users !== 1
    || state.workspaces !== 0
    || state.memberships !== 0
    || state.devices !== 0
  ) {
    throw new Error(
      `Historical migration 0018 test boundary has unexpected scratch data. state=${JSON.stringify(state)}`,
    );
  }
}

async function seedMigration0099LegacyInvalidMediaAsset(client) {
  const userId = "migration-0099-legacy-invalid-media-asset";
  const workspaceId = "09900000-0000-4000-8000-000000000001";
  const replicaId = "09900000-0000-4000-8000-000000000002";
  const mediaBlobId = "09900000-0000-4000-8000-000000000003";
  const mediaAssetId = "09900000-0000-4000-8000-000000000004";
  const sha256 = "9".repeat(64);
  const timestamp = "2026-07-29T00:00:00.000Z";

  await client.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1)",
    [userId],
  );
  await client.query(
    `INSERT INTO org.workspaces (
       workspace_id, name, fsrs_client_updated_at,
       fsrs_last_modified_by_replica_id, fsrs_last_operation_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      workspaceId,
      "Migration 0099 legacy media asset",
      timestamp,
      replicaId,
      "migration-0099-legacy-workspace",
    ],
  );
  await client.query(
    `INSERT INTO org.workspace_memberships (
       workspace_id, user_id, role
     ) VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await client.query(
    `INSERT INTO sync.workspace_replicas (
       replica_id, workspace_id, user_id, actor_kind, installation_id,
       actor_key, platform, app_version
     ) VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', $5)`,
    [
      replicaId,
      workspaceId,
      userId,
      "migration-0099-legacy-replica",
      "postgres-integration",
    ],
  );
  await client.query(
    `INSERT INTO content.media_blobs (
       media_blob_id, sha256, mime_type, size_bytes, storage_key,
       normalization_version
     ) VALUES ($1, $2, 'image/png', 1, $3, 'passthrough-v1')`,
    [
      mediaBlobId,
      sha256,
      `media/blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
    ],
  );
  await client.query(
    `INSERT INTO content.media_assets (
       media_asset_id, workspace_id, media_blob_id, source_url, created_at,
       client_updated_at, last_modified_by_replica_id, last_operation_id
     ) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
    [
      mediaAssetId,
      workspaceId,
      mediaBlobId,
      timestamp,
      replicaId,
      "migration-0099-legacy-\u00a0operation",
    ],
  );

  const legacyActiveSessionId =
    "09940000-0000-4000-8000-000000000001";
  const legacyActiveMediaAssetId =
    "09940000-0000-4000-8000-000000000002";
  const legacyActiveSha256 = "d".repeat(64);
  await client.query(
    `INSERT INTO content.media_upload_sessions (
       media_upload_session_id, workspace_id, media_asset_id,
       media_blob_sha256, staging_storage_key, blob_storage_key,
       s3_upload_id, mime_type, size_bytes, part_size_bytes, part_count,
       state, source_url, asset_created_at, client_updated_at,
       last_modified_by_replica_id, last_operation_id, expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'migration-0099-legacy-active-upload',
       'application/octet-stream', 1, 1, 1, 'active', NULL, $7, $7, $8,
       'migration-0099-legacy-\u00a0active', '2099-07-29T00:00:00.000Z'
     )`,
    [
      legacyActiveSessionId,
      workspaceId,
      legacyActiveMediaAssetId,
      legacyActiveSha256,
      `media/uploads/workspaces/${workspaceId}/assets/${legacyActiveMediaAssetId}/sessions/${legacyActiveSessionId}`,
      `media/blobs/sha256/${legacyActiveSha256.slice(0, 2)}/${legacyActiveSha256.slice(2, 4)}/${legacyActiveSha256}`,
      timestamp,
      replicaId,
    ],
  );

  const legacyAttemptFixtures = [
    {
      kind: "replay",
      sessionId: "09910000-0000-4000-8000-000000000001",
      mediaAssetId: "09910000-0000-4000-8000-000000000002",
      attemptToken: "09910000-0000-4000-8000-000000000003",
      sha256: "a".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0replay",
      partsFingerprint: "1".repeat(64),
    },
    {
      kind: "cleanup",
      sessionId: "09920000-0000-4000-8000-000000000001",
      mediaAssetId: "09920000-0000-4000-8000-000000000002",
      attemptToken: "09920000-0000-4000-8000-000000000003",
      sha256: "b".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0cleanup",
      partsFingerprint: "2".repeat(64),
    },
    {
      kind: "handoff",
      sessionId: "09930000-0000-4000-8000-000000000001",
      mediaAssetId: "09930000-0000-4000-8000-000000000002",
      attemptToken: "09930000-0000-4000-8000-000000000003",
      sha256: "c".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0handoff",
      partsFingerprint: "3".repeat(64),
    },
  ];
  const sessionExpiresAt = "2099-07-29T00:00:00.000Z";
  await client.query(
    "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
    [userId, workspaceId],
  );
  for (const fixture of legacyAttemptFixtures) {
    const stagingStorageKey =
      `media/uploads/workspaces/${workspaceId}/assets/${fixture.mediaAssetId}/sessions/${fixture.sessionId}`;
    const blobStorageKey =
      `media/blobs/sha256/${fixture.sha256.slice(0, 2)}/${fixture.sha256.slice(2, 4)}/${fixture.sha256}`;
    const uploadId = `migration-0099-${fixture.kind}-upload`;
    await client.query(
      `INSERT INTO content.media_upload_sessions (
         media_upload_session_id, workspace_id, media_asset_id,
         media_blob_sha256, staging_storage_key, blob_storage_key,
         s3_upload_id, mime_type, size_bytes, part_size_bytes, part_count,
         state, source_url, asset_created_at, client_updated_at,
         last_modified_by_replica_id, last_operation_id, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'application/octet-stream',
         1, 1, 1, 'completing', NULL, $8, $8, $9, $10, $11
       )`,
      [
        fixture.sessionId,
        workspaceId,
        fixture.mediaAssetId,
        fixture.sha256,
        stagingStorageKey,
        blobStorageKey,
        uploadId,
        timestamp,
        replicaId,
        fixture.lastOperationId,
        sessionExpiresAt,
      ],
    );
    const begun = await client.query(
      `SELECT attempt_status, reservation_token
       FROM content.begin_media_upload_session_completion_attempt_with_owner(
         $1,
         3600000,
         ROW(
           $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
           'application/octet-stream',1,1,1,NULL,$12,$12,$13,
           'passthrough-v1',$14
         )::content.multipart_media_blob_writer_attempt_payload
       )`,
      [
        fixture.attemptToken,
        userId,
        workspaceId,
        fixture.sessionId,
        fixture.mediaAssetId,
        replicaId,
        fixture.lastOperationId,
        fixture.sha256,
        stagingStorageKey,
        blobStorageKey,
        uploadId,
        timestamp,
        sessionExpiresAt,
        fixture.partsFingerprint,
      ],
    );
    if (
      begun.rows[0]?.attempt_status !== "acquired"
      || typeof begun.rows[0]?.reservation_token !== "string"
    ) {
      throw new Error(
        `Migration 0099 legacy multipart attempt seed failed. kind=${fixture.kind} result=${JSON.stringify(begun.rows[0])}`,
      );
    }
  }
  await client.query(
    `UPDATE content.media_blob_writer_attempts
     SET state='cancelled', outcome='aborted', terminal_at=$2
     WHERE attempt_token=$1`,
    [legacyAttemptFixtures[0].attemptToken, timestamp],
  );
  await client.query(
    `UPDATE content.media_upload_sessions
     SET state='aborted', aborted_at=$2
     WHERE media_upload_session_id=$1`,
    [legacyAttemptFixtures[0].sessionId, timestamp],
  );
  await client.query(
    `UPDATE content.media_upload_sessions
     SET state='aborting'
     WHERE media_upload_session_id=$1`,
    [legacyAttemptFixtures[1].sessionId],
  );
}

async function seedMigration0103LegacyChatRun(client) {
  const userId = "migration-0103-legacy-chat-user";
  const workspaceId = "10300000-0000-4000-8000-000000000001";
  const replicaId = "10300000-0000-4000-8000-000000000002";
  const sessionId = "10300000-0000-4000-8000-000000000003";
  const assistantItemId = "10300000-0000-4000-8000-000000000004";
  const runId = "10300000-0000-4000-8000-000000000005";
  const timestamp = "2026-07-30T00:00:00.000Z";

  await client.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1)",
    [userId],
  );
  await client.query(
    `INSERT INTO org.workspaces (
       workspace_id, name, fsrs_client_updated_at,
       fsrs_last_modified_by_replica_id, fsrs_last_operation_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      workspaceId,
      "Migration 0103 legacy chat run",
      timestamp,
      replicaId,
      "migration-0103-legacy-workspace",
    ],
  );
  await client.query(
    `INSERT INTO org.workspace_memberships (
       workspace_id, user_id, role
     ) VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await client.query(
    `INSERT INTO sync.workspace_replicas (
       replica_id, workspace_id, user_id, actor_kind, installation_id,
       actor_key, platform, app_version
     ) VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', $5)`,
    [
      replicaId,
      workspaceId,
      userId,
      "migration-0103-legacy-replica",
      "postgres-integration",
    ],
  );
  await client.query(
    `INSERT INTO ai.chat_sessions (
       session_id, user_id, workspace_id, status, active_run_id
     ) VALUES ($1, $2, $3, 'running', $4)`,
    [sessionId, userId, workspaceId, runId],
  );
  await client.query(
    `INSERT INTO ai.chat_items (
       item_id, session_id, item_kind, state, payload
     ) VALUES (
       $1, $2, 'message', 'in_progress',
       '{"role":"assistant","content":[]}'::jsonb
     )`,
    [assistantItemId, sessionId],
  );
  await client.query(
    `INSERT INTO ai.chat_runs (
       run_id, session_id, assistant_item_id, status, request_id, model_id,
       reasoning_effort, timezone, turn_input
     ) VALUES (
       $1, $2, $3, 'queued', $4, 'gpt-5.4', 'medium', 'Europe/Madrid',
       '[]'::jsonb
     )`,
    [
      runId,
      sessionId,
      assistantItemId,
      "migration-0103-legacy-request",
    ],
  );
}

async function createExpectedMigrationRoles(
  client,
  fileName,
  boundaryState,
) {
  const expectedCreatedRoles = createdRolesByMigration.get(fileName) ?? [];
  for (const roleName of expectedCreatedRoles) {
    if (!boundaryState.initiallyAbsentRoleNames.has(roleName)) {
      throw new Error(
        `Refusing to create a PostgreSQL role that was not absent during the locked preflight. role=${roleName} migration=${fileName}`,
      );
    }
    if (boundaryState.ownedRoleOids.has(roleName)) {
      throw new Error(
        `PostgreSQL integration role is already marked as runner-owned before its creation migration. role=${roleName} migration=${fileName}`,
      );
    }
    await client.query(
      `CREATE ROLE ${escapeIdentifier(roleName)} LOGIN`,
    );
    const result = await client.query(
      "SELECT oid::text AS role_oid FROM pg_catalog.pg_roles WHERE rolname = $1",
      [roleName],
    );
    const roleOid = result.rows[0]?.role_oid;
    if (roleOid === undefined) {
      throw new Error(
        `PostgreSQL integration could not prove ownership of a role it created. role=${roleName} migration=${fileName}`,
      );
    }
    boundaryState.ownedRoleOids.set(roleName, roleOid);
  }
}

async function trackMigrationRoleOwnership(client, fileName, boundaryState) {
  const result = await client.query(
    `SELECT rolname, oid::text AS role_oid
     FROM pg_catalog.pg_roles
     WHERE rolname = ANY($1::text[])
     ORDER BY rolname`,
    [managedRoleNames],
  );
  const currentRoles = new Map(
    result.rows.map((row) => [row.rolname, row.role_oid]),
  );
  for (const [roleName, ownedRoleOid] of boundaryState.ownedRoleOids) {
    const currentRoleOid = currentRoles.get(roleName);
    if (currentRoleOid !== undefined && currentRoleOid !== ownedRoleOid) {
      throw new Error(
        `Managed PostgreSQL role identity changed during the integration run. role=${roleName} expectedOid=${ownedRoleOid} actualOid=${currentRoleOid}`,
      );
    }
  }

  const expectedCreatedRoles = new Set(createdRolesByMigration.get(fileName) ?? []);
  for (const roleName of currentRoles.keys()) {
    if (boundaryState.ownedRoleOids.has(roleName)) continue;
    throw new Error(
      `An unowned managed PostgreSQL role appeared during migrations. role=${roleName} migration=${fileName}`,
    );
  }
  for (const roleName of expectedCreatedRoles) {
    if (!boundaryState.ownedRoleOids.has(roleName)) {
      throw new Error(
        `Migration did not create its expected managed PostgreSQL role. role=${roleName} migration=${fileName}`,
      );
    }
  }
}

async function applySingleMigration(
  adminConnection,
  fileName,
  boundaryState,
  signalSupervisor,
  mutableWorkSupervisor,
) {
  const phase = `migration ${fileName}`;
  const clientOptions = createPostgresClientOptions(
    adminConnection,
    disposableDatabaseName,
    adminConnection.username,
    adminConnection.password,
    `postgres-integration-${fileName.slice(0, 4)}`,
  );
  const supervisedClient = createSupervisedPostgresClient(
    clientOptions,
    phase,
    null,
  );
  const { client } = supervisedClient;
  const mutableWork = mutableWorkSupervisor.register(
    phase,
    () => supervisedClient.abort(),
  );
  let transactionStarted = false;
  let primaryError = null;
  const finalizationErrors = [];
  try {
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      client.connect(),
      `${phase} connection establishment`,
    );
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      requirePostgresSessionContract(
        client,
        disposableDatabaseName,
        `${phase} session contract verification`,
      ),
      `${phase} session contract verification`,
    );
    await mutableWork.awaitOperation(
      requireConnectedDatabaseIdentityForWork(
        client,
        boundaryState,
        `${phase} connected database identity verification`,
      ),
      `${phase} connected database identity verification`,
    );
    mutableWork.assertCanStart();
    signalSupervisor.throwIfSignaled(`before migration ${fileName}`);
    await mutableWork.awaitOperation(
      (async () => {
        const sql = await readFile(
          join(migrationsDirectory, fileName),
          "utf8",
        );
        if (
          fileName
          === "0099_durable_multipart_completion_reconciliation.sql"
        ) {
          await client.query("BEGIN");
          transactionStarted = true;
          await seedMigration0099LegacyInvalidMediaAsset(client);
          await client.query("COMMIT");
          transactionStarted = false;
        }
        if (
          fileName
          === "0103_ai_chat_initiating_auth_classification.sql"
        ) {
          await client.query("BEGIN");
          transactionStarted = true;
          await seedMigration0103LegacyChatRun(client);
          await client.query("COMMIT");
          transactionStarted = false;
        }
        await client.query("BEGIN");
        transactionStarted = true;
        if (
          fileName
          === "0018_auto_provision_workspaces_and_scheduler_seed.sql"
        ) {
          // The 0001 local-development seed exercises migration 0018's
          // workspace/device cycle. Its deferred FK is satisfied when the
          // migration transaction inserts the corresponding device.
          await assertHistoricalSeedBoundary(client);
        }
        // Every migration gets its own production-like session and transaction.
        // This preserves migration 0035's ON COMMIT DROP temporary tables.
        await createExpectedMigrationRoles(
          client,
          fileName,
          boundaryState,
        );
        await client.query(sql);
        await trackMigrationRoleOwnership(client, fileName, boundaryState);
        signalSupervisor.throwIfSignaled(`migration ${fileName}`);
        await client.query(
          "INSERT INTO public.schema_migrations(filename) VALUES ($1)",
          [fileName],
        );
        await client.query("COMMIT");
        transactionStarted = false;
      })(),
      `${phase} transaction`,
    );
  } catch (error) {
    primaryError = contextualError(
      `PostgreSQL migration integration setup failed. file=${fileName}`,
      error,
    );
  }

  if (transactionStarted) {
    try {
      await mutableWork.awaitOperation(
        client.query("ROLLBACK"),
        `${phase} rollback`,
      );
    } catch (error) {
      finalizationErrors.push(contextualError(
        `PostgreSQL migration rollback failed. file=${fileName}`,
        error,
      ));
    }
  }
  try {
    await mutableWork.awaitOperation(
      supervisedClient.close(),
      `${phase} client close`,
    );
  } catch (error) {
    finalizationErrors.push(contextualError(
      `PostgreSQL migration client close failed. file=${fileName}`,
      error,
    ));
  }
  const backgroundFailure = supervisedClient.backgroundFailure();
  supervisedClient.detach();
  mutableWork.complete();

  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...(backgroundFailure === null ? [] : [backgroundFailure]),
      ...finalizationErrors,
    ],
    `PostgreSQL migration and session finalization failed. file=${fileName}`,
  );
  if (failure !== null) throw failure;
}

export async function assertOwnedRole(client, roleName, boundaryState) {
  const expectedRoleOid = boundaryState.ownedRoleOids.get(roleName);
  if (expectedRoleOid === undefined) {
    throw new Error(
      `Refusing to configure an unowned PostgreSQL role. role=${roleName}`,
    );
  }
  const result = await client.query(
    "SELECT oid::text AS role_oid FROM pg_catalog.pg_roles WHERE rolname = $1",
    [roleName],
  );
  const actualRoleOid = result.rows[0]?.role_oid;
  if (actualRoleOid !== expectedRoleOid) {
    throw new Error(
      `Refusing to configure a PostgreSQL role with an unverified identity. role=${roleName} expectedOid=${expectedRoleOid} actualOid=${actualRoleOid ?? "missing"}`,
    );
  }
}

export async function applyMigrationBoundary(
  adminConnection,
  migrationFiles,
  boundaryDefinition,
  boundaryState,
  lifecycleAdminSession,
  signalSupervisor,
  mutableWorkSupervisor,
) {
  const requireLifecycleDatabaseIdentity = (phase) => (
    lifecycleAdminSession.runWork(
      phase,
      (adminClient) => requireOwnedDatabaseIdentityForWork(
        adminClient,
        boundaryState,
        phase,
      ),
    )
  );
  await requireLifecycleDatabaseIdentity(
    `before schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
  );
  await withPostgresClient(
    createPostgresClientOptions(
      adminConnection,
      disposableDatabaseName,
      adminConnection.username,
      adminConnection.password,
      "postgres-integration-migration-runner",
    ),
    `schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
    async (setupClient) => {
      await requireConnectedDatabaseIdentityForWork(
        setupClient,
        boundaryState,
        `schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
      );
      const server = await setupClient.query(
        "SELECT current_setting('server_version_num')::int / 10000 AS major",
      );
      if (server.rows[0]?.major !== 18) {
        throw new Error(
          `PostgreSQL integration disposable database requires PostgreSQL 18. actualMajor=${server.rows[0]?.major}`,
        );
      }
      await setupClient.query(`
        CREATE TABLE public.schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },
    mutableWorkSupervisor,
  );
  await requireLifecycleDatabaseIdentity(
    `after schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
  );

  for (const fileName of migrationFiles) {
    await requireLifecycleDatabaseIdentity(
      `before migration ${fileName}`,
    );
    await applySingleMigration(
      adminConnection,
      fileName,
      boundaryState,
      signalSupervisor,
      mutableWorkSupervisor,
    );
    await requireLifecycleDatabaseIdentity(
      `after migration ${fileName}`,
    );
  }

  await requireLifecycleDatabaseIdentity(
    `before boundary verification for ${boundaryDefinition.migrationFileName}`,
  );
  await withPostgresClient(
    createPostgresClientOptions(
      adminConnection,
      disposableDatabaseName,
      adminConnection.username,
      adminConnection.password,
      "postgres-integration-boundary-verifier",
    ),
    `boundary verification for ${boundaryDefinition.migrationFileName}`,
    async (verificationClient) => {
      await requireConnectedDatabaseIdentityForWork(
        verificationClient,
        boundaryState,
        `boundary verification for ${boundaryDefinition.migrationFileName}`,
      );
      const state = await verificationClient.query(
        "SELECT count(*)::int AS migrations, max(filename) AS latest FROM public.schema_migrations",
      );
      if (
        state.rows[0]?.migrations !== boundaryDefinition.expectedMigrationCount
        || state.rows[0]?.latest !== boundaryDefinition.migrationFileName
      ) {
        throw new Error(
          `PostgreSQL integration schema_migrations boundary is invalid. expectedCount=${boundaryDefinition.expectedMigrationCount} expectedLatest=${boundaryDefinition.migrationFileName} actual=${JSON.stringify(state.rows[0])}`,
        );
      }
      await assertOwnedRole(
        verificationClient,
        "backend_app",
        boundaryState,
      );
      signalSupervisor.throwIfSignaled(
        `before backend_app configuration at ${boundaryDefinition.migrationFileName}`,
      );
      await verificationClient.query(
        `ALTER ROLE ${escapeIdentifier("backend_app")} WITH LOGIN PASSWORD ${escapeLiteral(backendRolePassword)}`,
      );
    },
    mutableWorkSupervisor,
  );
  await requireLifecycleDatabaseIdentity(
    `after boundary verification for ${boundaryDefinition.migrationFileName}`,
  );
}
