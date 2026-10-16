-- Schemas touched/read explicitly: auth, community, content, progress, org, security, pg_catalog.
-- Private prerequisite: the proved-account transaction owns activation and retirement.
CREATE FUNCTION community.transfer_account_community(source_user_id TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE source_profile UUID; target_profile UUID;
BEGIN
  PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  PERFORM 1 FROM community.public_profiles WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY user_id FOR UPDATE;
  SELECT public_profile_id INTO source_profile FROM community.public_profiles WHERE user_id = source_user_id;
  SELECT public_profile_id INTO target_profile FROM community.public_profiles WHERE user_id = target_user_id;

  IF source_profile IS NOT NULL THEN
    IF target_profile IS NULL THEN
      UPDATE community.public_profiles SET user_id = target_user_id, updated_at = now()
        WHERE user_id = source_user_id;
      target_profile := source_profile;
    ELSE
      UPDATE community.public_profiles AS target SET
        leaderboard_participation_enabled = target.leaderboard_participation_enabled
          AND source.leaderboard_participation_enabled,
        updated_at = now()
      FROM community.public_profiles AS source
      WHERE target.user_id = target_user_id AND source.user_id = source_user_id;
    END IF;
  END IF;

  -- Historical shared-workspace authorship moves too; no event or scheduling value changes.
  UPDATE content.review_events SET reviewed_by_user_id = target_user_id
    WHERE reviewed_by_user_id = source_user_id;
  UPDATE community.public_review_activity_facts SET
    reviewed_by_user_id = CASE WHEN reviewed_by_user_id = source_user_id THEN target_user_id ELSE reviewed_by_user_id END,
    public_profile_id = CASE WHEN public_profile_id = source_profile THEN target_profile ELSE public_profile_id END
    WHERE reviewed_by_user_id = source_user_id OR public_profile_id = source_profile;

  DELETE FROM progress.user_active_review_days WHERE reviewed_by_user_id IN (source_user_id, target_user_id);
  INSERT INTO progress.user_active_review_days (
    reviewed_by_user_id, local_date, review_count, first_reviewed_at_client,
    last_reviewed_at_client, time_zone, time_zone_source
  )
  SELECT target_user_id, reviewed_local_date, count(*)::INTEGER,
    min(reviewed_at_client), max(reviewed_at_client),
    (array_agg(reviewed_time_zone ORDER BY reviewed_at_client, review_event_id))[1],
    (array_agg(reviewed_time_zone_source ORDER BY reviewed_at_client, review_event_id))[1]
  FROM content.review_events
  WHERE reviewed_by_user_id = target_user_id AND reviewed_local_date IS NOT NULL
  GROUP BY reviewed_local_date;

  -- Insert transformed edges first: an existing canonical edge owns its private label and audit.
  INSERT INTO community.friendships (
    viewer_user_id, friend_user_id, friend_public_profile_id, friend_display_name,
    created_from_invitation_id, created_at
  )
  SELECT CASE WHEN viewer_user_id = source_user_id THEN target_user_id ELSE viewer_user_id END,
    CASE WHEN friend_user_id = source_user_id THEN target_user_id ELSE friend_user_id END,
    CASE WHEN friend_user_id = source_user_id THEN target_profile ELSE friend_public_profile_id END,
    friend_display_name, created_from_invitation_id, created_at
  FROM community.friendships
  WHERE (viewer_user_id = source_user_id OR friend_user_id = source_user_id)
    AND CASE WHEN viewer_user_id = source_user_id THEN target_user_id ELSE viewer_user_id END
      <> CASE WHEN friend_user_id = source_user_id THEN target_user_id ELSE friend_user_id END
  ON CONFLICT (viewer_user_id, friend_user_id) DO NOTHING;
  DELETE FROM community.friendships WHERE viewer_user_id = source_user_id OR friend_user_id = source_user_id;
  UPDATE community.friend_invitations SET
    inviter_user_id = CASE WHEN inviter_user_id = source_user_id THEN target_user_id ELSE inviter_user_id END,
    accepted_by_user_id = CASE WHEN accepted_by_user_id = source_user_id THEN target_user_id ELSE accepted_by_user_id END
    WHERE inviter_user_id = source_user_id OR accepted_by_user_id = source_user_id;

  -- Only these profiles are stale. Ordinary jobs regenerate counts and streaks from retained facts.
  DELETE FROM community.leaderboard_snapshot_entries WHERE public_profile_id IN (source_profile, target_profile);
  DELETE FROM community.streak_leaderboard_snapshot_entries WHERE public_profile_id IN (source_profile, target_profile);
  IF source_profile IS NOT NULL AND source_profile <> target_profile THEN
    UPDATE community.public_profile_aliases SET canonical_public_profile_id = target_profile
      WHERE canonical_public_profile_id = source_profile;
    DELETE FROM community.public_profiles WHERE user_id = source_user_id;
    INSERT INTO community.public_profile_aliases(alias_public_profile_id, canonical_public_profile_id)
      VALUES (source_profile, target_profile);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION community.transfer_account_community(TEXT, TEXT)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

ALTER FUNCTION community.accept_friend_invitation(TEXT, TEXT) RENAME TO accept_locked_friend_invitation;
REVOKE ALL ON FUNCTION community.accept_locked_friend_invitation(TEXT, TEXT)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

CREATE FUNCTION community.accept_friend_invitation(p_invite_token_hash TEXT, p_inviter_display_name_for_invitee TEXT)
RETURNS TABLE (acceptance_status TEXT, inviter_public_profile_id UUID, invitee_public_profile_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE inviter_id TEXT; fresh_inviter_id TEXT; invitee_id TEXT; account_id TEXT;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Friend acceptance requires a fresh read-committed transaction' USING ERRCODE = 'P0A01';
  END IF;
  invitee_id := security.current_user_id();
  IF invitee_id IS NULL THEN
    RAISE EXCEPTION 'Friend acceptance requires an authenticated account scope' USING ERRCODE = '28000';
  END IF;
  SELECT inviter_user_id INTO inviter_id FROM community.friend_invitations WHERE invite_token_hash = p_invite_token_hash;
  FOR account_id IN SELECT DISTINCT unnest(ARRAY[invitee_id, inviter_id]) ORDER BY 1 LOOP
    IF account_id IS NULL THEN CONTINUE; END IF;
    PERFORM auth.assert_account_write_scope(account_id);
  END LOOP;
  FOR account_id IN SELECT DISTINCT unnest(ARRAY[invitee_id, inviter_id]) ORDER BY 1 LOOP
    IF account_id IS NULL THEN CONTINUE; END IF;
    -- The caller can already hold a scoped user tuple. Never wait on its lifecycle owner.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('auth.account:' || account_id, 2::BIGINT)) THEN
      RAISE EXCEPTION 'Friend account lifecycle is busy; reload and retry acceptance' USING ERRCODE = 'P0A01';
    END IF;
    PERFORM auth.assert_account_live(account_id);
  END LOOP;
  SELECT inviter_user_id INTO fresh_inviter_id FROM community.friend_invitations WHERE invite_token_hash = p_invite_token_hash;
  IF fresh_inviter_id IS DISTINCT FROM inviter_id THEN
    RAISE EXCEPTION 'Invitation owner changed; reload and retry acceptance' USING ERRCODE = 'P0A01';
  END IF;
  RETURN QUERY SELECT * FROM community.accept_locked_friend_invitation(p_invite_token_hash, p_inviter_display_name_for_invitee);
END;
$$;
REVOKE ALL ON FUNCTION community.accept_friend_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.accept_friend_invitation(TEXT, TEXT) TO backend_app;
