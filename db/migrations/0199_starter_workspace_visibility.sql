-- Schemas touched/read explicitly: org, content, ai, catalog, sync, auth, security, pg_catalog.
-- Private eligibility is independent of the marker so locked union/consent transactions can reuse it.
CREATE FUNCTION org.workspace_is_unused_starter(target_workspace_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM org.workspaces AS workspace
    WHERE workspace.workspace_id = target_workspace_id
      AND workspace.creation_origin = 'automatic_starter'
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
          AND card.metadata->'version' = '1'::jsonb
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
          AND card.tags = ARRAY['demo']::text[]
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
REVOKE ALL ON FUNCTION org.workspace_is_unused_starter(UUID) FROM PUBLIC, backend_app, auth_app;

-- The request scope supplies authority; selected IDs only retain existing memberships.
-- Materialize before pagination/caps so an all-suppressed account still keeps one ID.
CREATE FUNCTION org.visible_workspace_ids(selected_workspace_id UUID) RETURNS TABLE (workspace_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH candidates AS MATERIALIZED (
    SELECT workspace.workspace_id, workspace.created_at,
      workspace.workspace_id = selected_workspace_id
        OR workspace.starter_suppressed_at IS NULL
        OR NOT org.workspace_is_unused_starter(workspace.workspace_id) AS visible
    FROM org.workspace_memberships AS membership
    JOIN org.workspaces AS workspace ON workspace.workspace_id = membership.workspace_id
    WHERE membership.user_id = auth.canonical_account_id(security.current_user_id())
  )
  SELECT candidates.workspace_id FROM candidates
  WHERE visible OR (NOT EXISTS (SELECT 1 FROM candidates WHERE visible)
    AND candidates.workspace_id = (SELECT fallback.workspace_id FROM candidates AS fallback
      ORDER BY fallback.created_at, fallback.workspace_id LIMIT 1))
  ORDER BY candidates.created_at, candidates.workspace_id;
$$;
REVOKE ALL ON FUNCTION org.visible_workspace_ids(UUID) FROM PUBLIC, backend_app, auth_app;
GRANT EXECUTE ON FUNCTION org.visible_workspace_ids(UUID) TO backend_app, auth_app;
