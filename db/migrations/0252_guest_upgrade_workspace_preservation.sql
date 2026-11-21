-- Schemas touched/read explicitly: auth, org, security, sync, content, community, progress, pg_catalog.

SET LOCAL lock_timeout = '30s';

ALTER TABLE auth.guest_upgrade_history
  ADD COLUMN requested_existing_workspace_id UUID;

ALTER TABLE auth.guest_upgrade_history
  ADD CONSTRAINT guest_upgrade_history_check CHECK (
    requested_existing_workspace_id IS NULL
    OR selection_type = 'existing'
  ) NOT VALID;

CREATE FUNCTION auth.transfer_guest_owned_workspaces(upgrade UUID, secret_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.guest_upgrade_history%ROWTYPE;
BEGIN
  -- The backend writes the receipt only after verifying the guest credential and target sign-in.
  SELECT * INTO receipt FROM auth.guest_upgrade_history AS history
    WHERE history.upgrade_id = upgrade
      AND history.source_guest_user_id = security.current_user_id()
      AND history.source_guest_session_secret_hash = secret_hash;
  IF NOT FOUND OR receipt.source_guest_user_id = receipt.target_user_id
    OR NOT EXISTS (SELECT 1 FROM auth.guest_sessions AS session
      WHERE session.session_id = receipt.source_guest_session_id
        AND session.user_id = receipt.source_guest_user_id
        AND session.session_secret_hash = secret_hash
        AND session.revoked_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM org.user_settings
      WHERE user_id = receipt.source_guest_user_id AND workspace_id = receipt.source_guest_workspace_id)
    OR EXISTS (SELECT 1 FROM auth.user_identities WHERE user_id = receipt.source_guest_user_id)
    OR NOT EXISTS (SELECT 1 FROM auth.user_identities
      WHERE provider_type = 'cognito' AND provider_subject = receipt.target_subject_user_id
        AND user_id = receipt.target_user_id)
    OR NOT EXISTS (SELECT 1 FROM org.workspace_memberships
      WHERE workspace_id = receipt.target_workspace_id AND user_id = receipt.target_user_id)
    THEN
      RAISE EXCEPTION 'Workspace ownership transfer requires a live guest upgrade' USING ERRCODE = '42501';
  END IF;

  INSERT INTO org.workspace_memberships AS destination(workspace_id, user_id, role, created_at)
    SELECT workspace_id, receipt.target_user_id, role, created_at
    FROM org.workspace_memberships
    WHERE user_id = receipt.source_guest_user_id AND role = 'owner'
      AND workspace_id <> receipt.source_guest_workspace_id
    ORDER BY workspace_id
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE destination.role <> EXCLUDED.role;

  -- An installation returning to the same workspace derives the same replica ID.
  UPDATE sync.workspace_replicas AS replica
    SET user_id = receipt.target_user_id
    FROM org.workspace_memberships AS source
    WHERE source.user_id = receipt.source_guest_user_id AND source.role = 'owner'
      AND source.workspace_id <> receipt.source_guest_workspace_id
      AND replica.user_id = source.user_id AND replica.workspace_id = source.workspace_id;

  WITH transferred_reviews AS (
    UPDATE content.review_events AS review
      SET reviewed_by_user_id = receipt.target_user_id
      FROM org.workspace_memberships AS source
      WHERE source.user_id = receipt.source_guest_user_id AND source.role = 'owner'
        AND source.workspace_id <> receipt.source_guest_workspace_id
        AND review.reviewed_by_user_id = source.user_id AND review.workspace_id = source.workspace_id
      RETURNING review.review_event_id, review.reviewed_local_date, review.reviewed_at_client,
        review.reviewed_time_zone, review.reviewed_time_zone_source
  ), transferred_facts AS (
    UPDATE community.public_review_activity_facts AS fact
      SET reviewed_by_user_id = receipt.target_user_id,
        public_profile_id = (SELECT public_profile_id FROM community.public_profiles WHERE user_id = receipt.target_user_id)
      FROM transferred_reviews AS review
      WHERE fact.review_event_id = review.review_event_id
        AND fact.reviewed_by_user_id = receipt.source_guest_user_id
  )
  INSERT INTO progress.user_active_review_days AS active_day (
    reviewed_by_user_id, local_date, review_count, first_reviewed_at_client,
    last_reviewed_at_client, time_zone, time_zone_source
  )
  SELECT receipt.target_user_id, reviewed_local_date, count(*)::INTEGER,
    min(reviewed_at_client), max(reviewed_at_client),
    (array_agg(reviewed_time_zone ORDER BY reviewed_at_client, review_event_id))[1],
    (array_agg(reviewed_time_zone_source ORDER BY reviewed_at_client, review_event_id))[1]
  FROM transferred_reviews
  WHERE reviewed_local_date IS NOT NULL
  GROUP BY reviewed_local_date
  ON CONFLICT (reviewed_by_user_id, local_date) DO UPDATE SET
    review_count = active_day.review_count + EXCLUDED.review_count,
    first_reviewed_at_client = LEAST(active_day.first_reviewed_at_client, EXCLUDED.first_reviewed_at_client),
    last_reviewed_at_client = GREATEST(active_day.last_reviewed_at_client, EXCLUDED.last_reviewed_at_client),
    time_zone = CASE WHEN EXCLUDED.first_reviewed_at_client < active_day.first_reviewed_at_client
      THEN EXCLUDED.time_zone ELSE active_day.time_zone END,
    time_zone_source = CASE WHEN EXCLUDED.first_reviewed_at_client < active_day.first_reviewed_at_client
      THEN EXCLUDED.time_zone_source ELSE active_day.time_zone_source END,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION auth.transfer_guest_owned_workspaces(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.transfer_guest_owned_workspaces(UUID, TEXT) TO backend_app;
