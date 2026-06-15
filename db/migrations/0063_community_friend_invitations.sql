-- Migration status: Current / canonical.
-- Introduces: friend invitation links and directed friendship rows for
--   community-only reads. Invite acceptance uses narrow SECURITY DEFINER
--   helpers so request-scoped backend sessions do not receive broad cross-user
--   table write access.

CREATE TABLE IF NOT EXISTS community.friend_invitations (
  friend_invitation_id UUID PRIMARY KEY,
  inviter_user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  invite_token_hash TEXT NOT NULL UNIQUE,
  invitee_display_name_for_inviter TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT REFERENCES org.user_settings(user_id) ON DELETE SET NULL,
  CONSTRAINT friend_invitations_invite_token_hash_format CHECK (
    invite_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT friend_invitations_invitee_display_name_valid CHECK (
    char_length(btrim(invitee_display_name_for_inviter)) BETWEEN 1 AND 30
    AND invitee_display_name_for_inviter !~ '[[:cntrl:]]'
  ),
  CONSTRAINT friend_invitations_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT friend_invitations_accepted_by_requires_accepted_at CHECK (
    accepted_by_user_id IS NULL OR accepted_at IS NOT NULL
  )
);

COMMENT ON TABLE community.friend_invitations IS
  'One single-use friend invite link created by an authenticated inviter. Token hashes are stored, never raw invite tokens.';
COMMENT ON COLUMN community.friend_invitations.invite_token_hash IS
  'Lowercase SHA-256 hex digest of the invite token. Raw invite tokens must not be stored.';
COMMENT ON COLUMN community.friend_invitations.invitee_display_name_for_inviter IS
  'Display name the inviter wants to see for the future friend after acceptance.';
COMMENT ON COLUMN community.friend_invitations.accepted_by_user_id IS
  'Authenticated user that consumed the invitation. Nullable after account deletion because the invitation audit row remains.';

CREATE TABLE IF NOT EXISTS community.friendships (
  viewer_user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  friend_user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  friend_public_profile_id UUID NOT NULL REFERENCES community.public_profiles(public_profile_id) ON DELETE CASCADE,
  friend_display_name TEXT NOT NULL,
  created_from_invitation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_user_id, friend_user_id),
  CONSTRAINT friendships_created_from_invitation_fkey
    FOREIGN KEY (created_from_invitation_id)
    REFERENCES community.friend_invitations(friend_invitation_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT friendships_not_self CHECK (viewer_user_id <> friend_user_id),
  CONSTRAINT friendships_friend_display_name_valid CHECK (
    char_length(btrim(friend_display_name)) BETWEEN 1 AND 30
    AND friend_display_name !~ '[[:cntrl:]]'
  )
);

COMMENT ON TABLE community.friendships IS
  'Directed friendship rows. Each friendship stores one row per viewer so each user can keep a private display name for the same friend.';
COMMENT ON COLUMN community.friendships.friend_public_profile_id IS
  'Opaque public community profile id for the friend shown to the viewer.';
COMMENT ON COLUMN community.friendships.friend_display_name IS
  'Viewer-private display name for the friend. This is not a public profile name.';
COMMENT ON COLUMN community.friendships.created_from_invitation_id IS
  'Invitation that created or consumed this directed friendship relationship.';

CREATE INDEX IF NOT EXISTS idx_friend_invitations_inviter_accepted_expires
  ON community.friend_invitations(inviter_user_id, accepted_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_friendships_viewer_public_profile
  ON community.friendships(viewer_user_id, friend_public_profile_id);

ALTER TABLE community.friend_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.friendships ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA community TO backend_app;

GRANT SELECT (
  friend_invitation_id,
  inviter_user_id,
  invitee_display_name_for_inviter,
  created_at,
  expires_at,
  accepted_at
) ON TABLE community.friend_invitations TO backend_app;

GRANT INSERT (
  friend_invitation_id,
  inviter_user_id,
  invite_token_hash,
  invitee_display_name_for_inviter,
  expires_at
) ON TABLE community.friend_invitations TO backend_app;

GRANT SELECT (
  viewer_user_id,
  friend_user_id,
  friend_public_profile_id,
  friend_display_name,
  created_from_invitation_id,
  created_at
) ON TABLE community.friendships TO backend_app;

DROP POLICY IF EXISTS friend_invitations_inviter_pending_select_runtime ON community.friend_invitations;
CREATE POLICY friend_invitations_inviter_pending_select_runtime
  ON community.friend_invitations
  FOR SELECT
  TO backend_app
  USING (
    inviter_user_id = security.current_user_id()
    AND accepted_at IS NULL
  );

DROP POLICY IF EXISTS friend_invitations_inviter_insert_runtime ON community.friend_invitations;
CREATE POLICY friend_invitations_inviter_insert_runtime
  ON community.friend_invitations
  FOR INSERT
  TO backend_app
  WITH CHECK (
    inviter_user_id = security.current_user_id()
    AND accepted_at IS NULL
    AND accepted_by_user_id IS NULL
  );

DROP POLICY IF EXISTS friendships_viewer_select_runtime ON community.friendships;
CREATE POLICY friendships_viewer_select_runtime
  ON community.friendships
  FOR SELECT
  TO backend_app
  USING (viewer_user_id = security.current_user_id());

CREATE OR REPLACE FUNCTION community.preview_friend_invitation(
  p_invite_token_hash TEXT
)
RETURNS TABLE (
  invitation_status TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_invite_token_hash IS NULL OR p_invite_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'community.preview_friend_invitation p_invite_token_hash must be a 64-character lowercase sha256 hex digest'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN active_invitation.expires_at IS NULL THEN 'inactive'::TEXT
      ELSE 'active'::TEXT
    END AS invitation_status,
    active_invitation.expires_at
  FROM (SELECT 1) AS singleton
  LEFT JOIN LATERAL (
    SELECT friend_invitations.expires_at
    FROM community.friend_invitations AS friend_invitations
    WHERE friend_invitations.invite_token_hash = p_invite_token_hash
      AND friend_invitations.accepted_at IS NULL
      AND friend_invitations.expires_at > now()
    LIMIT 1
  ) AS active_invitation ON TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION community.accept_friend_invitation(
  p_invite_token_hash TEXT,
  p_inviter_display_name_for_invitee TEXT
)
RETURNS TABLE (
  acceptance_status TEXT,
  inviter_public_profile_id UUID,
  invitee_public_profile_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invitation community.friend_invitations%ROWTYPE;
  v_invitee_user_id TEXT;
  v_inviter_public_profile_id UUID;
  v_invitee_public_profile_id UUID;
  v_has_inviter_friendship BOOLEAN;
  v_has_invitee_friendship BOOLEAN;
BEGIN
  IF p_invite_token_hash IS NULL OR p_invite_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'community.accept_friend_invitation p_invite_token_hash must be a 64-character lowercase sha256 hex digest'
      USING ERRCODE = '22023';
  END IF;

  IF p_inviter_display_name_for_invitee IS NULL
    OR char_length(btrim(p_inviter_display_name_for_invitee)) NOT BETWEEN 1 AND 30
    OR p_inviter_display_name_for_invitee ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'community.accept_friend_invitation p_inviter_display_name_for_invitee must be 1 to 30 trimmed characters and contain no control characters'
      USING ERRCODE = '22023';
  END IF;

  v_invitee_user_id := security.current_user_id();
  IF v_invitee_user_id IS NULL THEN
    RAISE EXCEPTION 'community.accept_friend_invitation requires security.current_user_id()'
      USING ERRCODE = '28000';
  END IF;

  SELECT friend_invitations.*
  INTO v_invitation
  FROM community.friend_invitations AS friend_invitations
  WHERE friend_invitations.invite_token_hash = p_invite_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'inactive'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_invitation.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'already_accepted'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_invitation.expires_at <= now() THEN
    RETURN QUERY SELECT 'inactive'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_invitation.inviter_user_id = v_invitee_user_id THEN
    RETURN QUERY SELECT 'self'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'community.friendships:'
      || char_length(LEAST(v_invitation.inviter_user_id, v_invitee_user_id))::TEXT
      || ':'
      || LEAST(v_invitation.inviter_user_id, v_invitee_user_id)
      || ':'
      || char_length(GREATEST(v_invitation.inviter_user_id, v_invitee_user_id))::TEXT
      || ':'
      || GREATEST(v_invitation.inviter_user_id, v_invitee_user_id),
      0::bigint
    )
  );

  SELECT
    EXISTS (
      SELECT 1
      FROM community.friendships AS friendships
      WHERE friendships.viewer_user_id = v_invitation.inviter_user_id
        AND friendships.friend_user_id = v_invitee_user_id
    ),
    EXISTS (
      SELECT 1
      FROM community.friendships AS friendships
      WHERE friendships.viewer_user_id = v_invitee_user_id
        AND friendships.friend_user_id = v_invitation.inviter_user_id
    )
  INTO v_has_inviter_friendship, v_has_invitee_friendship;

  IF v_has_inviter_friendship IS DISTINCT FROM v_has_invitee_friendship THEN
    RAISE EXCEPTION 'community.accept_friend_invitation found inconsistent directed friendship rows for inviter_user_id %, invitee_user_id %',
      v_invitation.inviter_user_id,
      v_invitee_user_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_has_inviter_friendship THEN
    UPDATE community.friend_invitations AS friend_invitations
    SET
      accepted_at = now(),
      accepted_by_user_id = v_invitee_user_id
    WHERE friend_invitations.friend_invitation_id = v_invitation.friend_invitation_id;

    SELECT public_profiles.public_profile_id
    INTO v_inviter_public_profile_id
    FROM community.public_profiles AS public_profiles
    WHERE public_profiles.user_id = v_invitation.inviter_user_id;

    SELECT public_profiles.public_profile_id
    INTO v_invitee_public_profile_id
    FROM community.public_profiles AS public_profiles
    WHERE public_profiles.user_id = v_invitee_user_id;

    RETURN QUERY SELECT 'already_friends'::TEXT, v_inviter_public_profile_id, v_invitee_public_profile_id;
    RETURN;
  END IF;

  INSERT INTO community.public_profiles (user_id, public_profile_id)
  VALUES
    (v_invitation.inviter_user_id, gen_random_uuid()),
    (v_invitee_user_id, gen_random_uuid())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT public_profiles.public_profile_id
  INTO v_inviter_public_profile_id
  FROM community.public_profiles AS public_profiles
  WHERE public_profiles.user_id = v_invitation.inviter_user_id;

  SELECT public_profiles.public_profile_id
  INTO v_invitee_public_profile_id
  FROM community.public_profiles AS public_profiles
  WHERE public_profiles.user_id = v_invitee_user_id;

  IF v_inviter_public_profile_id IS NULL OR v_invitee_public_profile_id IS NULL THEN
    RAISE EXCEPTION 'community.accept_friend_invitation could not resolve public profiles for inviter_user_id %, invitee_user_id %',
      v_invitation.inviter_user_id,
      v_invitee_user_id
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO community.friendships (
    viewer_user_id,
    friend_user_id,
    friend_public_profile_id,
    friend_display_name,
    created_from_invitation_id
  )
  VALUES
    (
      v_invitation.inviter_user_id,
      v_invitee_user_id,
      v_invitee_public_profile_id,
      v_invitation.invitee_display_name_for_inviter,
      v_invitation.friend_invitation_id
    ),
    (
      v_invitee_user_id,
      v_invitation.inviter_user_id,
      v_inviter_public_profile_id,
      p_inviter_display_name_for_invitee,
      v_invitation.friend_invitation_id
    );

  UPDATE community.friend_invitations AS friend_invitations
  SET
    accepted_at = now(),
    accepted_by_user_id = v_invitee_user_id
  WHERE friend_invitations.friend_invitation_id = v_invitation.friend_invitation_id;

  RETURN QUERY SELECT 'accepted'::TEXT, v_inviter_public_profile_id, v_invitee_public_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION community.preview_friend_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.preview_friend_invitation(TEXT) TO backend_app;

REVOKE ALL ON FUNCTION community.accept_friend_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.accept_friend_invitation(TEXT, TEXT) TO backend_app;

COMMENT ON FUNCTION community.preview_friend_invitation(TEXT) IS
  'Returns only active/inactive plus active expiry for a friend invitation token hash. Never exposes inviter identity.';
COMMENT ON FUNCTION community.accept_friend_invitation(TEXT, TEXT) IS
  'Accepts an active friend invitation for security.current_user_id(), creates two directed friendship rows, consumes the invitation, and returns an explicit acceptance status.';
