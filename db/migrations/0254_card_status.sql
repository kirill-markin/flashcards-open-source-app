-- Schemas touched/read explicitly: content, org, ai, catalog, sync, pg_catalog.

SET LOCAL lock_timeout = '30s';

ALTER TABLE content.cards
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE content.cards
  ADD CONSTRAINT cards_status_check CHECK (status IN ('active', 'suspended')) NOT VALID;

-- Default-active rows must keep matching baselines saved before the column existed.
CREATE OR REPLACE FUNCTION org.workspace_starter_baseline(target_workspace_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('workspace',encode(sha256(convert_to((to_jsonb(w)-'starter_suppressed_at')::TEXT,'UTF8')),'hex'),
    'cards',encode(sha256(convert_to(COALESCE((SELECT jsonb_agg(
      CASE WHEN c.status = 'active' THEN to_jsonb(c) - 'status' ELSE to_jsonb(c) END ORDER BY card_id
    ) FROM content.cards c WHERE c.workspace_id=w.workspace_id),'[]'::JSONB)::TEXT,'UTF8')),'hex'))
  FROM org.workspaces w WHERE w.workspace_id=target_workspace_id
    AND (SELECT count(*) FROM content.cards WHERE workspace_id=target_workspace_id) <= 1;
$$;

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
          AND card.status = 'active'
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
