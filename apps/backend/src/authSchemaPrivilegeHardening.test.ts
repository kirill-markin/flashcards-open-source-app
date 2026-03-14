import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const runtimeRolesMigrationPath = path.resolve(process.cwd(), "../../db/migrations/0024_auth_runtime_roles.sql");
const cleanupMigrationPath = path.resolve(process.cwd(), "../../db/migrations/0025_remove_legacy_app_role.sql");
const migrateScriptPath = path.resolve(process.cwd(), "../../scripts/migrate.sh");
const backendAgentApiKeysPath = path.resolve(process.cwd(), "src/agentApiKeys.ts");
const backendWorkspacesPath = path.resolve(process.cwd(), "src/workspaces.ts");

const runtimeRolesMigrationSql = readFileSync(runtimeRolesMigrationPath, "utf8");
const cleanupMigrationSql = readFileSync(cleanupMigrationPath, "utf8");
const migrateScript = readFileSync(migrateScriptPath, "utf8");
const backendAgentApiKeysSource = readFileSync(backendAgentApiKeysPath, "utf8");
const backendWorkspacesSource = readFileSync(backendWorkspacesPath, "utf8");

test("0024_auth_runtime_roles enables RLS on auth.agent_api_keys", () => {
  assert.match(runtimeRolesMigrationSql, /ALTER TABLE auth\.agent_api_keys ENABLE ROW LEVEL SECURITY;/);
});

test("0024_auth_runtime_roles targets backend_app and auth_app in auth.agent_api_keys policies", () => {
  assert.match(
    runtimeRolesMigrationSql,
    /CREATE POLICY agent_api_keys_select_runtime[\s\S]*TO backend_app, auth_app[\s\S]*user_id = security\.current_user_id\(\)/,
  );
  assert.match(
    runtimeRolesMigrationSql,
    /CREATE POLICY agent_api_keys_insert_runtime[\s\S]*TO auth_app[\s\S]*user_id = security\.current_user_id\(\)/,
  );
  assert.match(
    runtimeRolesMigrationSql,
    /CREATE POLICY agent_api_keys_update_runtime[\s\S]*TO backend_app[\s\S]*user_id = security\.current_user_id\(\)/,
  );
});

test("0024_auth_runtime_roles keeps runtime roles off broad auth schema grants and grants bootstrap lookup only to backend_app", () => {
  assert.doesNotMatch(
    runtimeRolesMigrationSql,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO backend_app;/,
  );
  assert.doesNotMatch(
    runtimeRolesMigrationSql,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_app;/,
  );
  assert.match(
    runtimeRolesMigrationSql,
    /GRANT EXECUTE ON FUNCTION auth\.authenticate_agent_api_key\(TEXT\) TO backend_app;/,
  );
});

test("0025_remove_legacy_app_role removes the shared app role", () => {
  assert.match(cleanupMigrationSql, /DROP ROLE app;/);
  assert.match(cleanupMigrationSql, /REVOKE USAGE ON SCHEMA auth FROM app;/);
});

test("backend auth agent key flows use scoped queries and the bootstrap function", () => {
  assert.match(
    backendAgentApiKeysSource,
    /FROM auth\.authenticate_agent_api_key\(\$1\)/,
  );
  assert.match(
    backendAgentApiKeysSource,
    /export async function listAgentApiKeyConnectionsPageForUser[\s\S]*queryWithUserScope<AgentApiKeyRow>\(\s*\{ userId \}/,
  );
  assert.match(
    backendAgentApiKeysSource,
    /export async function revokeAgentApiKeyConnectionForUser[\s\S]*queryWithUserScope<AgentApiKeyRow>\(\s*\{ userId \}/,
  );
});

test("backend selected workspace updates for API keys run in a user-scoped transaction", () => {
  assert.match(
    backendWorkspacesSource,
    /export async function setSelectedWorkspaceForApiKeyConnection[\s\S]*transactionWithUserScope\(\{ userId \}/,
  );
});

test("local migration script configures backend_app and auth_app passwords", () => {
  assert.match(migrateScript, /BACKEND_DB_PASSWORD/);
  assert.match(migrateScript, /AUTH_DB_PASSWORD/);
  assert.doesNotMatch(migrateScript, /APP_DB_PASSWORD/);
});
