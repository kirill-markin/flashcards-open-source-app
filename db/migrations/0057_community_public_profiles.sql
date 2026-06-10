-- Migration status: Current / canonical.
-- Introduces: stable opaque community identities and leaderboard participation preference.

CREATE SCHEMA IF NOT EXISTS community;

CREATE TABLE IF NOT EXISTS community.public_profiles (
  user_id TEXT PRIMARY KEY REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  public_profile_id UUID NOT NULL UNIQUE,
  leaderboard_participation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE community.public_profiles IS
  'One stable opaque public community identity per app user. Internal user ids must not be returned to clients.';
COMMENT ON COLUMN community.public_profiles.public_profile_id IS
  'Opaque stable id safe to expose in community-facing client payloads.';
COMMENT ON COLUMN community.public_profiles.leaderboard_participation_enabled IS
  'User preference for leaderboard participation. Leaderboard reads are implemented by backend service code.';

ALTER TABLE community.public_profiles ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA community TO backend_app;
GRANT SELECT (
  user_id,
  public_profile_id,
  leaderboard_participation_enabled
) ON TABLE community.public_profiles TO backend_app;
GRANT INSERT (
  user_id,
  public_profile_id
) ON TABLE community.public_profiles TO backend_app;
GRANT UPDATE (
  leaderboard_participation_enabled,
  updated_at
) ON TABLE community.public_profiles TO backend_app;

DROP POLICY IF EXISTS public_profiles_self_select_runtime ON community.public_profiles;
CREATE POLICY public_profiles_self_select_runtime
  ON community.public_profiles
  FOR SELECT
  TO backend_app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS public_profiles_self_insert_runtime ON community.public_profiles;
CREATE POLICY public_profiles_self_insert_runtime
  ON community.public_profiles
  FOR INSERT
  TO backend_app
  WITH CHECK (user_id = security.current_user_id());

DROP POLICY IF EXISTS public_profiles_self_participation_update_runtime ON community.public_profiles;
CREATE POLICY public_profiles_self_participation_update_runtime
  ON community.public_profiles
  FOR UPDATE
  TO backend_app
  USING (user_id = security.current_user_id())
  WITH CHECK (user_id = security.current_user_id());

CREATE OR REPLACE FUNCTION community.transfer_guest_public_profile(
  source_guest_user_id TEXT,
  target_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF target_user_id IS DISTINCT FROM security.current_user_id() THEN
    RAISE EXCEPTION 'community.transfer_guest_public_profile target_user_id must match security.current_user_id()'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM community.public_profiles AS guest_profile
    WHERE guest_profile.user_id = source_guest_user_id
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM community.public_profiles AS target_profile
    WHERE target_profile.user_id = target_user_id
  ) THEN
    UPDATE community.public_profiles AS target_profile
    SET
      leaderboard_participation_enabled = (
        target_profile.leaderboard_participation_enabled
        AND guest_profile.leaderboard_participation_enabled
      ),
      updated_at = now()
    FROM community.public_profiles AS guest_profile
    WHERE target_profile.user_id = target_user_id
      AND guest_profile.user_id = source_guest_user_id;
  ELSE
    UPDATE community.public_profiles AS guest_profile
    SET
      user_id = target_user_id,
      updated_at = now()
    WHERE guest_profile.user_id = source_guest_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION community.transfer_guest_public_profile(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.transfer_guest_public_profile(TEXT, TEXT) TO backend_app;

COMMENT ON FUNCTION community.transfer_guest_public_profile(TEXT, TEXT) IS
  'Transfers a guest public community profile or its leaderboard participation preference to the target account during guest upgrade before source user cleanup.';
