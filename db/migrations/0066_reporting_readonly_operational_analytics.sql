-- Migration status: Current / canonical.
-- Introduces: read-only reporting access to operational analytics metadata.
-- Current guidance: reporting_readonly may inspect guest conversion, AI run
--   health, and current sync diagnostics. Secret hashes, raw chat payloads,
--   prompts, suggestions, and legacy payload-heavy sync feeds remain hidden.

GRANT USAGE ON SCHEMA auth TO reporting_readonly;
GRANT USAGE ON SCHEMA ai TO reporting_readonly;

REVOKE SELECT ON ALL TABLES IN SCHEMA auth FROM reporting_readonly;
REVOKE SELECT ON ALL TABLES IN SCHEMA ai FROM reporting_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  REVOKE SELECT ON TABLES FROM reporting_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  REVOKE SELECT ON TABLES FROM reporting_readonly;

GRANT SELECT (
  provider_type,
  user_id,
  created_at
) ON TABLE auth.user_identities TO reporting_readonly;

GRANT SELECT (
  session_id,
  user_id,
  created_at,
  last_seen_at,
  revoked_at,
  platform
) ON TABLE auth.guest_sessions TO reporting_readonly;

GRANT SELECT (
  user_id,
  usage_month,
  weighted_tokens,
  updated_at
) ON TABLE auth.guest_ai_monthly_usage TO reporting_readonly;

GRANT SELECT (
  upgrade_id,
  source_guest_user_id,
  source_guest_workspace_id,
  source_guest_session_id,
  target_user_id,
  target_workspace_id,
  selection_type,
  merged_at
) ON TABLE auth.guest_upgrade_history TO reporting_readonly;

GRANT SELECT (
  source_guest_replica_id,
  upgrade_id,
  target_replica_id,
  merged_at
) ON TABLE auth.guest_replica_aliases TO reporting_readonly;

GRANT SELECT (
  session_id,
  user_id,
  workspace_id,
  status,
  active_run_heartbeat_at,
  main_content_invalidation_version,
  active_run_id,
  active_composer_suggestion_generation_id,
  created_at,
  updated_at
) ON TABLE ai.chat_sessions TO reporting_readonly;

GRANT SELECT (
  run_id,
  session_id,
  assistant_item_id,
  status,
  request_id,
  model_id,
  reasoning_effort,
  timezone,
  worker_claimed_at,
  worker_heartbeat_at,
  cancel_requested_at,
  started_at,
  finished_at,
  created_at,
  updated_at,
  ui_locale,
  ai_cost_mode,
  chat_turns_last_7d,
  good_review_days_last_7d
) ON TABLE ai.chat_runs TO reporting_readonly;

GRANT SELECT (
  generation_id,
  session_id,
  assistant_item_id,
  source,
  invalidated_at,
  invalidated_reason,
  created_at
) ON TABLE ai.chat_composer_suggestion_generations TO reporting_readonly;

GRANT SELECT (
  workspace_id,
  min_available_hot_change_id,
  updated_at
) ON TABLE sync.workspace_sync_metadata TO reporting_readonly;

GRANT SELECT (
  change_id,
  workspace_id,
  entity_type,
  entity_id,
  action,
  operation_id,
  client_updated_at,
  recorded_at,
  replica_id
) ON TABLE sync.hot_changes TO reporting_readonly;

GRANT SELECT (
  workspace_id,
  operation_id,
  operation_type,
  entity_type,
  entity_id,
  client_updated_at,
  resulting_hot_change_id,
  applied_at,
  replica_id
) ON TABLE sync.applied_operations_current TO reporting_readonly;

DROP POLICY IF EXISTS chat_sessions_reporting_readonly_select ON ai.chat_sessions;
CREATE POLICY chat_sessions_reporting_readonly_select
  ON ai.chat_sessions
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS chat_runs_reporting_readonly_select ON ai.chat_runs;
CREATE POLICY chat_runs_reporting_readonly_select
  ON ai.chat_runs
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS chat_composer_suggestion_generations_reporting_readonly_select ON ai.chat_composer_suggestion_generations;
CREATE POLICY chat_composer_suggestion_generations_reporting_readonly_select
  ON ai.chat_composer_suggestion_generations
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS workspace_sync_metadata_reporting_readonly_select ON sync.workspace_sync_metadata;
CREATE POLICY workspace_sync_metadata_reporting_readonly_select
  ON sync.workspace_sync_metadata
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS hot_changes_reporting_readonly_select ON sync.hot_changes;
CREATE POLICY hot_changes_reporting_readonly_select
  ON sync.hot_changes
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS applied_operations_current_reporting_readonly_select ON sync.applied_operations_current;
CREATE POLICY applied_operations_current_reporting_readonly_select
  ON sync.applied_operations_current
  FOR SELECT
  TO reporting_readonly
  USING (true);
