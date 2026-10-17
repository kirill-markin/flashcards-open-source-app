-- Schemas touched/read explicitly: auth, org, pg_catalog.
CREATE OR REPLACE FUNCTION auth.preview_account_connection(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, omitted UUID[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE before_lock auth.account_connection_proofs%ROWTYPE; receipt auth.account_connection_proofs%ROWTYPE;
  preview_choices JSONB; omission_candidates JSONB;
BEGIN
  before_lock := auth.discover_connection_pair(operation,subject,username,original_auth_time,binding,client,origin);
  PERFORM auth.lock_account_retirement(before_lock.target_account,before_lock.source_account);
  SELECT * INTO STRICT receipt FROM auth.claim_account_connection_proofs(operation,subject,username,original_auth_time,binding,client,origin);
  IF ROW(receipt.operation_id,receipt.source_account,receipt.target_account,receipt.source_proof,receipt.target_session,receipt.provider_session)
    IS DISTINCT FROM ROW(before_lock.operation_id,before_lock.source_account,before_lock.target_account,
      before_lock.source_proof,before_lock.target_session,before_lock.provider_session) THEN
    RAISE EXCEPTION 'Connection pair changed while waiting; start again' USING ERRCODE = 'P4201';
  END IF;
  PERFORM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  preview_choices := auth.prepare_account_connection_choices(operation,omitted);
  UPDATE auth.account_connection_proofs SET choices = preview_choices,
    preview_digest = preview_choices->>'digest' WHERE operation_sha256 = operation;
  -- Presentation eligibility never changes the saved choices or guarantees final suppression.
  SELECT COALESCE(jsonb_agg(root.value->'workspace'->>'workspace_id' ORDER BY root.value->'workspace'->>'workspace_id'),'[]'::JSONB)
    INTO omission_candidates
    FROM jsonb_array_elements(preview_choices->'preview'->'workspaces') AS root(value)
    WHERE root.value->'workspace'->>'creation_origin' = 'unknown'
      AND org.workspace_is_unused_starter((root.value->'workspace'->>'workspace_id')::UUID,
        org.workspace_starter_baseline((root.value->'workspace'->>'workspace_id')::UUID));
  RETURN jsonb_build_object('choices',preview_choices,'omissionCandidateWorkspaceIds',omission_candidates);
END;
$$;
REVOKE ALL ON FUNCTION auth.preview_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID[])
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.preview_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID[]) TO auth_app;
