-- Migration status: Current / additive.
-- Introduces: ai.workspace_chat_instructions, the custom instructions a workspace's owner saves for the in-app AI chat.
--   No row means none are set. Members read them; only owners write them. reporting_readonly gets nothing.
-- Current guidance: a table rather than an org.workspaces column, because reporting_readonly reads whole
--   org.workspaces rows (0044) and org.workspace_starter_baseline hashes the whole row (0212).
-- Current guidance: a saved preference makes a workspace used, so org.workspace_is_unused_starter now reads it.
-- Schemas touched/read explicitly: ai, org, content, catalog, sync, security, pg_catalog.

-- The foreign key takes SHARE ROW EXCLUSIVE on org.workspaces; cap the wait like 0173 does.
SET LOCAL lock_timeout = '30s';

CREATE TABLE ai.workspace_chat_instructions (
  workspace_id        UUID        PRIMARY KEY REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  custom_instructions TEXT        NOT NULL CHECK (char_length(custom_instructions) BETWEEN 1 AND 1500),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.workspace_chat_instructions TO backend_app;

ALTER TABLE ai.workspace_chat_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_chat_instructions_scoped_select_runtime
  ON ai.workspace_chat_instructions
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY workspace_chat_instructions_owner_insert_runtime
  ON ai.workspace_chat_instructions
  FOR INSERT
  TO backend_app
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND security.current_user_is_workspace_owner(workspace_id)
  );

CREATE POLICY workspace_chat_instructions_owner_update_runtime
  ON ai.workspace_chat_instructions
  FOR UPDATE
  TO backend_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND security.current_user_is_workspace_owner(workspace_id)
  )
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND security.current_user_is_workspace_owner(workspace_id)
  );

CREATE POLICY workspace_chat_instructions_owner_delete_runtime
  ON ai.workspace_chat_instructions
  FOR DELETE
  TO backend_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND security.current_user_is_workspace_owner(workspace_id)
  );

CREATE OR REPLACE FUNCTION org.workspace_is_unused_starter(target_workspace_id UUID, historical_baseline JSONB) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM org.workspaces AS workspace
    WHERE workspace.workspace_id = target_workspace_id
      AND (workspace.creation_origin = 'automatic_starter'
        OR workspace.creation_origin = 'unknown' AND historical_baseline IS NOT NULL
          AND historical_baseline = org.workspace_starter_baseline(target_workspace_id))
      AND workspace.name = 'Personal'
      AND workspace.fsrs_algorithm = 'fsrs-6'
      AND workspace.fsrs_desired_retention = 0.9
      AND workspace.fsrs_learning_steps_minutes = '[1,10]'::jsonb
      AND workspace.fsrs_relearning_steps_minutes = '[10]'::jsonb
      AND workspace.fsrs_maximum_interval_days = 36500
      AND workspace.fsrs_enable_fuzz = true
      AND (SELECT count(*) FROM org.workspace_memberships WHERE workspace_id = target_workspace_id) = 1
      AND EXISTS (SELECT 1 FROM org.workspace_memberships
        WHERE workspace_id = target_workspace_id AND role = 'owner')
      AND (SELECT count(*) FROM content.cards WHERE workspace_id = target_workspace_id) <= 1
      AND NOT EXISTS (
        SELECT 1 FROM content.cards AS card
        WHERE card.workspace_id = target_workspace_id AND NOT COALESCE(
          card.deleted_at IS NULL
          AND card.card_type = 'basic'
          AND card.front_text <> ''
          AND (workspace.creation_origin = 'unknown' OR (
            card.metadata->'version' = '1'::jsonb
          AND CASE WHEN jsonb_typeof(card.metadata) = 'object' THEN
            card.metadata - ARRAY['version', 'source', 'onboardingDemo'] END = '{}'::jsonb
          AND (card.metadata->'source' = 'null'::jsonb OR card.metadata->'source' = jsonb_build_object(
            'label', NULL, 'author', NULL, 'comment', NULL, 'importedAt', NULL, 'importId', NULL,
            'createdAt', to_char(date_trunc('milliseconds', card.created_at AT TIME ZONE 'UTC'),
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
          AND jsonb_typeof(card.metadata->'onboardingDemo') = 'object'
          AND card.metadata->'onboardingDemo'->'version' = '1'::jsonb
          AND CASE WHEN jsonb_typeof(card.metadata->'onboardingDemo') = 'object' THEN
            (card.metadata->'onboardingDemo') - ARRAY[
              'version', 'frontText', 'backText', 'tags', 'cardType', 'wasEdited'] END = '{}'::jsonb
          AND (NOT (card.metadata->'onboardingDemo' ? 'wasEdited')
            OR card.metadata->'onboardingDemo'->'wasEdited' = 'false'::jsonb)
          AND card.metadata->'onboardingDemo'->'frontText' = to_jsonb(card.front_text)
          AND card.metadata->'onboardingDemo'->'backText' = to_jsonb(card.back_text)
          AND card.metadata->'onboardingDemo'->'cardType' = to_jsonb(card.card_type)
          AND card.metadata->'onboardingDemo'->'tags' = to_jsonb(ARRAY(
            SELECT DISTINCT tag FROM unnest(card.tags) AS tag ORDER BY tag))
          AND card.tags = ARRAY['demo']::text[]))
          AND card.due_at IS NULL AND card.reps = 0 AND card.lapses = 0
          AND card.fsrs_card_state = 'new' AND card.fsrs_step_index IS NULL
          AND card.fsrs_stability IS NULL AND card.fsrs_difficulty IS NULL
          AND card.fsrs_last_reviewed_at IS NULL AND card.fsrs_scheduled_days IS NULL,
          false)
      )
      -- Stored roots include tombstones and terminal/archived history. Replicas,
      -- bootstrap hot rows and ordinary demo-sync idempotency alone prove no adoption.
      AND NOT EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM ai.chat_sessions WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM ai.workspace_chat_instructions WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_assets WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_upload_sessions WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_upload_session_creation_claims WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_blob_writer_reservations WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_blob_writer_attempts WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.generated_media_promotion_jobs WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM catalog.package_versions WHERE source_workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM sync.catalog_package_install_idempotency WHERE workspace_id = target_workspace_id)
  );
$$;
REVOKE ALL ON FUNCTION org.workspace_is_unused_starter(UUID,JSONB) FROM PUBLIC, backend_app, auth_app;
