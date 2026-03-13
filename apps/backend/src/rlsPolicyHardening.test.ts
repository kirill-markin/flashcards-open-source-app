import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(process.cwd(), "../../db/migrations/0022_rls_policy_hardening.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

test("0022_rls_policy_hardening enforces accessible selected workspace updates", () => {
  assert.match(
    migrationSql,
    /CREATE POLICY user_settings_self_update[\s\S]*workspace_id IS NULL[\s\S]*security\.user_has_workspace_access\(workspace_id\)/,
  );
});

test("0022_rls_policy_hardening restricts workspace delete to sole-member owners", () => {
  assert.match(
    migrationSql,
    /CREATE POLICY workspaces_access_delete[\s\S]*security\.current_user_is_workspace_owner\(workspace_id\)[\s\S]*security\.current_user_is_sole_workspace_member\(workspace_id\)/,
  );
});

test("0022_rls_policy_hardening leaves workspace membership deletes without an app policy", () => {
  assert.match(migrationSql, /DROP POLICY IF EXISTS workspace_memberships_self_delete ON org\.workspace_memberships;/);
  assert.doesNotMatch(
    migrationSql,
    /CREATE POLICY [\w_]+\s+ON org\.workspace_memberships\s+FOR DELETE/i,
  );
});
