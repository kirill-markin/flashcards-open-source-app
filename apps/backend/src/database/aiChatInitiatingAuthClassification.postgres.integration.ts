import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const legacyUserId = "migration-0103-legacy-chat-user";
const legacyWorkspaceId = "10300000-0000-4000-8000-000000000001";
const legacyRunId = "10300000-0000-4000-8000-000000000005";

type ColumnContractRow = Readonly<{
  data_type: string;
  is_not_null: boolean;
  column_default: string | null;
  comment: string | null;
  backend_can_select: boolean;
  backend_can_insert: boolean;
  auth_can_select: boolean;
  reporting_can_select: boolean;
}>;

type ClassificationRow = Readonly<{
  initiating_auth_is_signed_in: boolean;
}>;

type RuntimeRunFixture = Readonly<{
  assistantItemId: string;
  requestId: string;
  runId: string;
  sessionId: string;
}>;

function requireDatabaseUrl(
  environmentVariable: "DATABASE_URL" | "TEST_DATABASE_ADMIN_URL",
): string {
  const databaseUrl = process.env[environmentVariable]?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      `${environmentVariable} is required for the initiating-auth migration integration test.`,
    );
  }
  return databaseUrl;
}

function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

function createRuntimeRunFixture(): RuntimeRunFixture {
  const runId = randomUUID();
  return {
    assistantItemId: randomUUID(),
    requestId: `migration-0103-runtime-${runId}`,
    runId,
    sessionId: randomUUID(),
  };
}

async function insertRuntimeRunScaffolding(
  client: pg.PoolClient,
  fixture: RuntimeRunFixture,
): Promise<void> {
  await client.query(
    `INSERT INTO ai.chat_sessions (
       session_id, user_id, workspace_id, status, active_run_id
     ) VALUES ($1, $2, $3, 'running', $4)`,
    [
      fixture.sessionId,
      legacyUserId,
      legacyWorkspaceId,
      fixture.runId,
    ],
  );
  await client.query(
    `INSERT INTO ai.chat_items (
       item_id, session_id, item_kind, state, payload
     ) VALUES (
       $1, $2, 'message', 'in_progress',
       '{"role":"assistant","content":[]}'::jsonb
     )`,
    [
      fixture.assistantItemId,
      fixture.sessionId,
    ],
  );
}

async function insertRuntimeRunWithClassification(
  client: pg.PoolClient,
  initiatingAuthIsSignedIn: boolean | null,
): Promise<boolean> {
  const fixture = createRuntimeRunFixture();
  await insertRuntimeRunScaffolding(client, fixture);
  const result = await client.query<ClassificationRow>(
    `INSERT INTO ai.chat_runs (
       run_id, session_id, assistant_item_id, status, request_id, model_id,
       reasoning_effort, timezone, turn_input,
       initiating_auth_is_signed_in
     ) VALUES (
       $1, $2, $3, 'queued', $4, 'gpt-5.6-terra', 'xhigh', 'Europe/Madrid',
       '[]'::jsonb, $5
     )
     RETURNING initiating_auth_is_signed_in`,
    [
      fixture.runId,
      fixture.sessionId,
      fixture.assistantItemId,
      fixture.requestId,
      initiatingAuthIsSignedIn,
    ],
  );
  const classification = result.rows[0]?.initiating_auth_is_signed_in;
  if (classification === undefined) {
    throw new Error(
      `Inserted chat run returned no auth classification. runId=${fixture.runId}`,
    );
  }
  return classification;
}

async function insertRuntimeRunWithDefaultClassification(
  client: pg.PoolClient,
): Promise<boolean> {
  const fixture = createRuntimeRunFixture();
  await insertRuntimeRunScaffolding(client, fixture);
  const result = await client.query<ClassificationRow>(
    `INSERT INTO ai.chat_runs (
       run_id, session_id, assistant_item_id, status, request_id, model_id,
       reasoning_effort, timezone, turn_input
     ) VALUES (
       $1, $2, $3, 'queued', $4, 'gpt-5.6-terra', 'xhigh', 'Europe/Madrid',
       '[]'::jsonb
     )
     RETURNING initiating_auth_is_signed_in`,
    [
      fixture.runId,
      fixture.sessionId,
      fixture.assistantItemId,
      fixture.requestId,
    ],
  );
  const classification = result.rows[0]?.initiating_auth_is_signed_in;
  if (classification === undefined) {
    throw new Error(
      `Inserted chat run returned no default auth classification. runId=${fixture.runId}`,
    );
  }
  return classification;
}

test("migration 0103 adds the initiating-auth classification at the SQL boundary", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireDatabaseUrl("TEST_DATABASE_ADMIN_URL"),
    application_name: "initiating-auth-migration-owner",
  });
  const runtimePool = new pg.Pool({
    connectionString: requireDatabaseUrl("DATABASE_URL"),
    application_name: "initiating-auth-migration-runtime",
  });

  try {
    const contract = await ownerPool.query<ColumnContractRow>(`
      SELECT
        pg_catalog.format_type(attributes.atttypid, attributes.atttypmod)
          AS data_type,
        attributes.attnotnull AS is_not_null,
        pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid)
          AS column_default,
        pg_catalog.col_description(
          attributes.attrelid,
          attributes.attnum
        ) AS comment,
        pg_catalog.has_column_privilege(
          'backend_app',
          'ai.chat_runs',
          'initiating_auth_is_signed_in',
          'SELECT'
        ) AS backend_can_select,
        pg_catalog.has_column_privilege(
          'backend_app',
          'ai.chat_runs',
          'initiating_auth_is_signed_in',
          'INSERT'
        ) AS backend_can_insert,
        pg_catalog.has_column_privilege(
          'auth_app',
          'ai.chat_runs',
          'initiating_auth_is_signed_in',
          'SELECT'
        ) AS auth_can_select,
        pg_catalog.has_column_privilege(
          'reporting_readonly',
          'ai.chat_runs',
          'initiating_auth_is_signed_in',
          'SELECT'
        ) AS reporting_can_select
      FROM pg_catalog.pg_attribute AS attributes
      LEFT JOIN pg_catalog.pg_attrdef AS defaults
        ON defaults.adrelid = attributes.attrelid
       AND defaults.adnum = attributes.attnum
      WHERE attributes.attrelid = 'ai.chat_runs'::pg_catalog.regclass
        AND attributes.attname = 'initiating_auth_is_signed_in'
        AND NOT attributes.attisdropped
    `);
    assert.deepEqual(contract.rows, [{
      data_type: "boolean",
      is_not_null: true,
      column_default: "false",
      comment:
        "Immutable classification of the transport that initiated the run. Existing rows default to guest-ineligible.",
      backend_can_select: true,
      backend_can_insert: true,
      auth_can_select: false,
      reporting_can_select: false,
    }]);

    const ownerLegacyRow = await ownerPool.query<ClassificationRow>(
      `SELECT initiating_auth_is_signed_in
       FROM ai.chat_runs
       WHERE run_id = $1`,
      [legacyRunId],
    );
    assert.deepEqual(ownerLegacyRow.rows, [{
      initiating_auth_is_signed_in: false,
    }]);

    const runtimeClient = await runtimePool.connect();
    try {
      await runtimeClient.query("BEGIN");
      await runtimeClient.query(
        `SELECT
           set_config('app.user_id', $1, true),
           set_config('app.workspace_id', $2, true)`,
        [legacyUserId, legacyWorkspaceId],
      );
      const runtimeLegacyRow = await runtimeClient.query<ClassificationRow>(
        `SELECT initiating_auth_is_signed_in
         FROM ai.chat_runs
         WHERE run_id = $1`,
        [legacyRunId],
      );
      assert.deepEqual(runtimeLegacyRow.rows, [{
        initiating_auth_is_signed_in: false,
      }]);
      assert.equal(
        await insertRuntimeRunWithClassification(runtimeClient, true),
        true,
      );
      assert.equal(
        await insertRuntimeRunWithDefaultClassification(runtimeClient),
        false,
      );

      await runtimeClient.query("SAVEPOINT null_classification_probe");
      try {
        await insertRuntimeRunWithClassification(runtimeClient, null);
        assert.fail("Expected a null initiating-auth classification to be rejected.");
      } catch (error) {
        assert.ok(
          hasPostgresCode(error, "23502"),
          `Expected PostgreSQL not-null violation 23502. error=${String(error)}`,
        );
      }
      await runtimeClient.query("ROLLBACK TO SAVEPOINT null_classification_probe");
      await runtimeClient.query("ROLLBACK");
    } finally {
      runtimeClient.release();
    }
  } finally {
    await Promise.all([runtimePool.end(), ownerPool.end()]);
  }
});
