-- Migration status: Current / canonical.
-- Introduces: auth-side cleanup for account deletion without broad runtime DELETE grants.
-- Current guidance: this migration refines the account-deletion lineage introduced around db/migrations/0019_account_delete_tombstones.sql and aligned with the runtime-role split.
-- Replaces or corrects: db/migrations/0019_account_delete_tombstones.sql.
-- See also: db/migrations/0024_auth_runtime_roles.sql, docs/architecture.md.
-- Delete auth-side state for one account without broad runtime DELETE grants.

CREATE OR REPLACE FUNCTION auth.delete_user_auth_artifacts(
  target_user_id TEXT,
  target_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM auth.agent_api_keys
  WHERE user_id = target_user_id;

  IF target_email IS NOT NULL THEN
    DELETE FROM auth.agent_otp_challenges
    WHERE email = target_email;

    DELETE FROM auth.otp_send_events
    WHERE email = target_email;

    DELETE FROM auth.otp_verify_attempts
    WHERE email = target_email;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION auth.delete_user_auth_artifacts(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.delete_user_auth_artifacts(TEXT, TEXT) TO backend_app;

COMMENT ON FUNCTION auth.delete_user_auth_artifacts(TEXT, TEXT) IS
  'Deletes auth-side API keys and email-keyed OTP state for one deleted account.';
