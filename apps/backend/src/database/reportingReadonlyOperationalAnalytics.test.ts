import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("0066 migration grants reporting access to operational analytics metadata only", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0066_reporting_readonly_operational_analytics.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /GRANT USAGE ON SCHEMA auth TO reporting_readonly/);
  assert.match(sql, /GRANT USAGE ON SCHEMA ai TO reporting_readonly/);
  assert.match(sql, /REVOKE SELECT ON ALL TABLES IN SCHEMA auth FROM reporting_readonly/);
  assert.match(sql, /REVOKE SELECT ON ALL TABLES IN SCHEMA ai FROM reporting_readonly/);

  assert.match(sql, /GRANT SELECT \([^)]*provider_type,[^)]*user_id,[^)]*created_at[^)]*\) ON TABLE auth\.user_identities TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*session_id,[^)]*user_id,[^)]*last_seen_at,[^)]*platform[^)]*\) ON TABLE auth\.guest_sessions TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*user_id,[^)]*usage_month,[^)]*weighted_tokens,[^)]*updated_at[^)]*\) ON TABLE auth\.guest_ai_monthly_usage TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*upgrade_id,[^)]*source_guest_user_id,[^)]*target_user_id,[^)]*selection_type,[^)]*merged_at[^)]*\) ON TABLE auth\.guest_upgrade_history TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*source_guest_replica_id,[^)]*upgrade_id,[^)]*target_replica_id,[^)]*merged_at[^)]*\) ON TABLE auth\.guest_replica_aliases TO reporting_readonly/);

  assert.match(sql, /GRANT SELECT \([^)]*session_id,[^)]*user_id,[^)]*workspace_id,[^)]*status,[^)]*active_run_id[^)]*\) ON TABLE ai\.chat_sessions TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*run_id,[^)]*session_id,[^)]*status,[^)]*request_id,[^)]*model_id,[^)]*ai_cost_mode[^)]*\) ON TABLE ai\.chat_runs TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*generation_id,[^)]*session_id,[^)]*source,[^)]*invalidated_reason,[^)]*created_at[^)]*\) ON TABLE ai\.chat_composer_suggestion_generations TO reporting_readonly/);

  assert.match(sql, /GRANT SELECT \([^)]*workspace_id,[^)]*min_available_hot_change_id,[^)]*updated_at[^)]*\) ON TABLE sync\.workspace_sync_metadata TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*change_id,[^)]*workspace_id,[^)]*entity_type,[^)]*operation_id,[^)]*replica_id[^)]*\) ON TABLE sync\.hot_changes TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*workspace_id,[^)]*operation_id,[^)]*operation_type,[^)]*resulting_hot_change_id,[^)]*replica_id[^)]*\) ON TABLE sync\.applied_operations_current TO reporting_readonly/);

  assert.match(sql, /CREATE POLICY chat_sessions_reporting_readonly_select ON ai\.chat_sessions FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY chat_runs_reporting_readonly_select ON ai\.chat_runs FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY chat_composer_suggestion_generations_reporting_readonly_select ON ai\.chat_composer_suggestion_generations FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY workspace_sync_metadata_reporting_readonly_select ON sync\.workspace_sync_metadata FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY hot_changes_reporting_readonly_select ON sync\.hot_changes FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY applied_operations_current_reporting_readonly_select ON sync\.applied_operations_current FOR SELECT TO reporting_readonly USING \(true\)/);

  assert.equal(sql.includes("session_secret_hash"), false);
  assert.equal(sql.includes("source_guest_session_secret_hash"), false);
  assert.equal(sql.includes("provider_subject"), false);
  assert.equal(sql.includes("auth.admin_users"), false);
  assert.equal(sql.includes("auth.agent_api_keys"), false);
  assert.equal(sql.includes("auth.agent_otp_challenges"), false);
  assert.equal(sql.includes("ai.chat_items"), false);
  assert.equal(sql.includes("turn_input"), false);
  assert.equal(sql.includes("last_error_message"), false);
  assert.equal(sql.includes("composer_suggestions"), false);
  assert.doesNotMatch(sql, /GRANT SELECT \([^)]*suggestions[^)]*\) ON TABLE ai\.chat_composer_suggestion_generations/);
  assert.equal(sql.includes("sync.changes"), false);
});
