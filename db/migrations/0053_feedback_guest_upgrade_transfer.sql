-- Migration status: Current / canonical.
-- Introduces: guest-account upgrade transfer helper for in-app feedback rows.
-- Current guidance: support feedback is user-scoped and follows the upgraded account.

CREATE OR REPLACE FUNCTION support.transfer_guest_feedback(
  source_guest_user_id TEXT,
  source_guest_workspace_id UUID,
  target_user_id TEXT,
  target_workspace_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF target_user_id IS DISTINCT FROM security.current_user_id() THEN
    RAISE EXCEPTION 'support.transfer_guest_feedback target_user_id must match security.current_user_id()'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT security.user_has_workspace_access(target_workspace_id) THEN
    RAISE EXCEPTION 'support.transfer_guest_feedback target user must have access to target_workspace_id'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE support.feedback_prompt_events
  SET
    user_id = target_user_id,
    workspace_id = CASE
      WHEN workspace_id = source_guest_workspace_id THEN target_workspace_id
      ELSE workspace_id
    END
  WHERE user_id = source_guest_user_id;

  UPDATE support.feedback_submissions
  SET
    user_id = target_user_id,
    workspace_id = CASE
      WHEN workspace_id = source_guest_workspace_id THEN target_workspace_id
      ELSE workspace_id
    END
  WHERE user_id = source_guest_user_id;
END;
$$;

REVOKE ALL ON FUNCTION support.transfer_guest_feedback(TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support.transfer_guest_feedback(TEXT, UUID, TEXT, UUID) TO backend_app;

COMMENT ON FUNCTION support.transfer_guest_feedback(TEXT, UUID, TEXT, UUID) IS
  'Transfers guest feedback ownership to the target account during guest upgrade before source user cleanup.';
